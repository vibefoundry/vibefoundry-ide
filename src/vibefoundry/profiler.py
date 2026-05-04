"""
Large file profiler for VibeFoundry IDE.
Streams through massive files in chunks, appending per-chunk stats to a
profiling Parquet on disk so RAM stays flat. Final pass does dedup/aggregate.
"""

import os
import hashlib
import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Optional, Callable

import polars as pl


# Concurrency for chunk processing. Polars itself uses all cores within
# each chunk, so 2-4 workers gives good pipelining (one chunk's I/O
# overlaps another's compute) without thrashing the global thread pool.
_PROFILE_WORKERS = min(4, max(2, (os.cpu_count() or 4) // 2))


# --- Configuration ---
HIGH_CARDINALITY_THRESHOLD = None  # Capture all unique values
CHUNK_ROWS = 500_000  # Rows per chunk for profiling
# Files larger than 100MB trigger the massive-file flow
MASSIVE_FILE_SIZE_THRESHOLD = 100 * 1024 * 1024  # 100MB



MASSIVE_ROW_THRESHOLD = 500_000  # 500k rows

def is_file_massive(file_path: Path, total_rows: int = 0) -> bool:
    """Check if a file is larger than 100MB or has more than 500k rows."""
    try:
        file_size = file_path.stat().st_size
        return file_size > MASSIVE_FILE_SIZE_THRESHOLD or total_rows > MASSIVE_ROW_THRESHOLD
    except Exception:
        return False


def get_profile_cache_path(project_folder: Path, file_path: Path) -> Path:
    """Get the path where the profiling Parquet should be stored."""
    # Hash the absolute file path to create a unique filename
    path_hash = hashlib.md5(str(file_path.resolve()).encode()).hexdigest()[:12]
    stem = file_path.stem
    return project_folder / "app_folder" / "meta_data" / f"profile_{stem}_{path_hash}.parquet"


def _get_profile_meta_path(profile_path: Path) -> Path:
    """JSON sidecar that stores the source file's mtime."""
    return profile_path.with_suffix(".meta.json")


def is_profile_valid(profile_path: Path, file_path: Path) -> bool:
    """Check if a cached profile exists and matches the current file mtime."""
    meta_path = _get_profile_meta_path(profile_path)
    if not profile_path.exists() or not meta_path.exists():
        return False
    try:
        with open(meta_path) as f:
            meta = json.load(f)
        return meta.get("source_mtime") == file_path.stat().st_mtime
    except Exception:
        return False


def _save_profile_meta(profile_path: Path, file_path: Path, extra: dict = None):
    """Write the JSON sidecar with source mtime and any extra info."""
    meta = {"source_mtime": file_path.stat().st_mtime}
    if extra:
        meta.update(extra)
    meta_path = _get_profile_meta_path(profile_path)
    with open(meta_path, "w") as f:
        json.dump(meta, f)


def _classify_columns(lf: pl.LazyFrame) -> tuple[list[str], list[str]]:
    """Split columns into numeric and categorical lists."""
    schema = lf.collect_schema()
    numeric_cols = []
    categorical_cols = []
    for col in schema.names():
        dtype = schema[col]
        if dtype.is_numeric():
            numeric_cols.append(col)
        else:
            categorical_cols.append(col)
    return numeric_cols, categorical_cols


def _get_lazy_frame(file_path: Path, file_type: str, separator: str = ",") -> pl.LazyFrame:
    """Create a lazy frame for the given file."""
    if file_type == "csv":
        return pl.scan_csv(file_path, separator=separator, infer_schema_length=10000)
    elif file_type in ("parquet", "geoparquet"):
        return pl.scan_parquet(file_path)
    else:
        raise ValueError(f"Unsupported file type for profiling: {file_type}")


def _detect_csv_separator(file_path: Path) -> str:
    """Detect CSV separator from first line."""
    with open(file_path, "rb") as f:
        sample = f.read(4096)
    first_line = sample.split(b"\n")[0].decode("utf-8", errors="replace")
    if "\t" in first_line:
        return "\t"
    elif ";" in first_line:
        return ";"
    return ","


def profile_large_file(
    file_path: Path,
    file_type: str,
    project_folder: Path,
    progress_callback: Optional[Callable[[int, int], None]] = None,
) -> dict:
    """
    Profile a massive file by streaming in chunks, appending per-chunk stats
    to a temporary Parquet on disk, then doing a final aggregate pass.

    Returns the final profile dict:
    {
        "columns": {
            "col_name": {
                "type": "numeric" | "categorical",
                "min": ..., "max": ...,           # numeric
                "values": [...],                   # categorical (capped)
                "high_cardinality": bool,
                "null_count": int,
            }
        },
        "total_rows": int,
        "file_size": int,
    }
    """
    separator = ","
    if file_type == "csv":
        separator = _detect_csv_separator(file_path)

    lf = _get_lazy_frame(file_path, file_type, separator)
    numeric_cols, categorical_cols = _classify_columns(lf)

    # Count total rows — cheap for Parquet (footer), fast estimate for CSV (byte counting)
    if file_type == "csv":
        # Fast: count newlines without parsing
        count = 0
        with open(file_path, 'rb') as f:
            for buf in iter(lambda: f.read(1024 * 1024), b''):
                count += buf.count(b'\n')
        total_rows = max(0, count - 1)  # subtract header
    else:
        total_rows = lf.select(pl.len()).collect().item()
    total_chunks = max(1, (total_rows + CHUNK_ROWS - 1) // CHUNK_ROWS)

    profile_path = get_profile_cache_path(project_folder, file_path)
    profile_path.parent.mkdir(parents=True, exist_ok=True)

    def _process_chunk(chunk_idx: int) -> list[dict]:
        """Compute per-column stats for a single chunk. Pure function — no
        shared state, safe to call from multiple threads in parallel."""
        offset = chunk_idx * CHUNK_ROWS
        chunk_df = lf.slice(offset, CHUNK_ROWS).collect()
        if len(chunk_df) == 0:
            return []

        rows: list[dict] = []
        for col in numeric_cols:
            series = chunk_df[col]
            col_min = series.min()
            col_max = series.max()
            rows.append({
                "column": col,
                "col_type": "numeric",
                "cat_value": None,
                "num_min": float(col_min) if col_min is not None else None,
                "num_max": float(col_max) if col_max is not None else None,
                "null_count": int(series.null_count()),
            })

        for col in categorical_cols:
            series = chunk_df[col]
            null_count = int(series.null_count())
            try:
                unique_vals = series.drop_nulls().cast(pl.Utf8).unique().to_list()
                unique_vals = [str(v) for v in unique_vals if v != ""]
            except Exception:
                unique_vals = []

            if unique_vals:
                # First row carries the chunk's null_count for this column;
                # remaining unique-value rows have null_count=0 to avoid
                # double-counting at aggregation time.
                for i, val in enumerate(unique_vals):
                    rows.append({
                        "column": col,
                        "col_type": "categorical",
                        "cat_value": val,
                        "num_min": None,
                        "num_max": None,
                        "null_count": null_count if i == 0 else 0,
                    })
            else:
                rows.append({
                    "column": col,
                    "col_type": "categorical",
                    "cat_value": None,
                    "num_min": None,
                    "num_max": None,
                    "null_count": null_count,
                })

        return rows

    # --- Process chunks in parallel; accumulate stats in memory ---
    # Was: sequential for-loop + O(n^2) read-concat-write of a temp Parquet.
    # Now: ThreadPoolExecutor pipelines chunks (Polars uses all cores within
    # each), and per-chunk stats are tiny (~one row per column), so keeping
    # them in memory is fine even for huge files.
    all_stats_rows: list[dict] = []
    completed = 0
    with ThreadPoolExecutor(max_workers=_PROFILE_WORKERS) as executor:
        futures = {executor.submit(_process_chunk, i): i for i in range(total_chunks)}
        for future in as_completed(futures):
            try:
                all_stats_rows.extend(future.result())
            except Exception as e:
                print(f"[profile_large_file] chunk {futures[future]} failed: {e}")
            completed += 1
            if progress_callback:
                progress_callback(completed, total_chunks)

    # --- Final aggregation pass over the in-memory stats ---
    profile_result = {"columns": {}, "total_rows": total_rows, "file_size": file_path.stat().st_size}

    if all_stats_rows:
        raw = pl.DataFrame(all_stats_rows)

        for col in numeric_cols:
            col_data = raw.filter(
                (pl.col("column") == col) & (pl.col("col_type") == "numeric")
            )
            if len(col_data) > 0:
                profile_result["columns"][col] = {
                    "type": "numeric",
                    "min": col_data["num_min"].min(),
                    "max": col_data["num_max"].max(),
                    "null_count": col_data["null_count"].sum(),
                    "high_cardinality": False,
                }
            else:
                profile_result["columns"][col] = {
                    "type": "numeric", "min": None, "max": None,
                    "null_count": 0, "high_cardinality": False,
                }

        for col in categorical_cols:
            col_data = raw.filter(
                (pl.col("column") == col) & (pl.col("col_type") == "categorical")
            )
            null_count = col_data["null_count"].sum()
            unique_values = (
                col_data.filter(pl.col("cat_value").is_not_null())
                .select(pl.col("cat_value").unique())
            )
            vals = sorted(unique_values["cat_value"].to_list())
            profile_result["columns"][col] = {
                "type": "categorical",
                "values": vals,
                "null_count": null_count,
                "high_cardinality": False,
            }

        del raw

    _write_final_profile(profile_path, profile_result)
    _save_profile_meta(profile_path, file_path, extra={
        "total_rows": total_rows,
        "file_size": file_path.stat().st_size,
    })

    return profile_result


def _write_final_profile(profile_path: Path, profile_result: dict):
    """Serialize the profile result into a Parquet for fast future reads."""
    rows = []
    for col_name, info in profile_result["columns"].items():
        rows.append({
            "column": col_name,
            "col_type": info["type"],
            "values_json": json.dumps(info.get("values", [])),
            "num_min": info.get("min"),
            "num_max": info.get("max"),
            "null_count": info.get("null_count", 0),
            "high_cardinality": info.get("high_cardinality", False),
        })
    if rows:
        pl.DataFrame(rows).write_parquet(profile_path)


def read_cached_profile(profile_path: Path) -> dict:
    """Read a previously saved profile from disk."""
    if not profile_path.exists():
        return {}

    df = pl.read_parquet(profile_path)
    meta_path = _get_profile_meta_path(profile_path)
    total_rows = 0
    file_size = 0
    if meta_path.exists():
        with open(meta_path) as f:
            meta = json.load(f)
        total_rows = meta.get("total_rows", 0)
        file_size = meta.get("file_size", 0)

    columns = {}
    for row in df.to_dicts():
        col_name = row["column"]
        if row["col_type"] == "numeric":
            columns[col_name] = {
                "type": "numeric",
                "min": row["num_min"],
                "max": row["num_max"],
                "null_count": row["null_count"],
                "high_cardinality": row["high_cardinality"],
            }
        else:
            columns[col_name] = {
                "type": "categorical",
                "values": json.loads(row["values_json"]) if row["values_json"] else [],
                "null_count": row["null_count"],
                "high_cardinality": row["high_cardinality"],
            }

    del df
    return {"columns": columns, "total_rows": total_rows, "file_size": file_size}


def apply_column_exclusions(
    lf: pl.LazyFrame,
    column: str,
    exclude,
    schema=None,
) -> pl.LazyFrame:
    """Apply per-column value exclusions to a lazy frame.

    `exclude` is a list of tokens. Supported tokens:
      - "null"  — drop rows where the column is null
      - "zero"  — drop rows where the numeric value equals 0
      - "nan"   — drop rows where the float value is NaN
      - "blank" — drop rows where the string value is empty/whitespace

    Tokens are silently skipped when the column's dtype makes them meaningless
    (e.g. "zero" on a string column, "nan" on an integer column).
    """
    if not exclude:
        return lf

    tokens = set(exclude) if isinstance(exclude, (list, tuple, set)) else set()
    if not tokens:
        return lf

    dtype = None
    if schema is not None:
        try:
            dtype = schema.get(column) if hasattr(schema, "get") else schema[column]
        except Exception:
            dtype = None

    is_numeric = dtype is not None and hasattr(dtype, "is_numeric") and dtype.is_numeric()
    is_float = dtype in (pl.Float32, pl.Float64)
    is_string_like = dtype is None or (not is_numeric)

    if "null" in tokens:
        lf = lf.filter(pl.col(column).is_not_null())
    if "zero" in tokens and (is_numeric or dtype is None):
        try:
            lf = lf.filter(pl.col(column).cast(pl.Float64, strict=False) != 0)
        except Exception:
            pass
    if "nan" in tokens and is_float:
        try:
            lf = lf.filter(~pl.col(column).is_nan())
        except Exception:
            pass
    if "blank" in tokens and is_string_like:
        try:
            lf = lf.filter(pl.col(column).cast(pl.Utf8).str.strip_chars() != "")
        except Exception:
            pass

    return lf


def estimate_filtered_rows(
    file_path: Path,
    file_type: str,
    filters: dict,
    separator: str = ","
) -> int:
    """Estimate row count after applying filters. Uses Polars predicate pushdown
    on Parquet (reads only row-group metadata that matches), so it's fast even
    on huge files."""
    lf = _get_lazy_frame(file_path, file_type, separator)
    schema = lf.collect_schema()

    for col_name, filter_val in filters.items():
        if isinstance(filter_val, dict):
            if "values" in filter_val:
                vals = filter_val.get("values") or []
                if vals:
                    str_vals = [str(v) for v in vals]
                    lf = lf.filter(pl.col(col_name).cast(pl.Utf8).is_in(str_vals))
            else:
                # Numeric range filter
                if filter_val.get("min") not in (None, "", "null"):
                    try:
                        lf = lf.filter(pl.col(col_name).cast(pl.Float64, strict=False) >= float(filter_val["min"]))
                    except (ValueError, TypeError):
                        pass
                if filter_val.get("max") not in (None, "", "null"):
                    try:
                        lf = lf.filter(pl.col(col_name).cast(pl.Float64, strict=False) <= float(filter_val["max"]))
                    except (ValueError, TypeError):
                        pass
            lf = apply_column_exclusions(lf, col_name, filter_val.get("exclude") or [], schema)
        elif isinstance(filter_val, list) and len(filter_val) > 0:
            # Legacy categorical filter (plain list of values)
            str_vals = [str(v) for v in filter_val]
            lf = lf.filter(pl.col(col_name).cast(pl.Utf8).is_in(str_vals))

    return lf.select(pl.len()).collect().item()
