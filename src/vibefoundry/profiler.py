"""
Large file profiler for VibeFoundry IDE.
Streams through massive files in chunks, appending per-chunk stats to a
profiling Parquet on disk so RAM stays flat. Final pass does dedup/aggregate.
"""

import os
import hashlib
import json
import time
from pathlib import Path
from typing import Optional, Callable

import polars as pl


# --- Configuration ---
HIGH_CARDINALITY_THRESHOLD = None  # Capture all unique values
CHUNK_ROWS = 500_000  # Rows per chunk for profiling
# Files larger than 100MB trigger the massive-file flow
MASSIVE_FILE_SIZE_THRESHOLD = 100 * 1024 * 1024  # 100MB



def is_file_massive(file_path: Path, total_rows: int = 0) -> bool:
    """Check if a file is larger than 100MB."""
    try:
        file_size = file_path.stat().st_size
        return file_size > MASSIVE_FILE_SIZE_THRESHOLD
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

    # Count total rows (cheap for Parquet — reads footer metadata)
    total_rows = lf.select(pl.len()).collect().item()
    total_chunks = max(1, (total_rows + CHUNK_ROWS - 1) // CHUNK_ROWS)

    profile_path = get_profile_cache_path(project_folder, file_path)
    # Ensure meta_data dir exists
    profile_path.parent.mkdir(parents=True, exist_ok=True)

    # Clean up any previous temp profile
    temp_profile_path = profile_path.with_suffix(".tmp.parquet")
    if temp_profile_path.exists():
        temp_profile_path.unlink()

    # --- Stream chunks, append stats to disk ---
    for chunk_idx in range(total_chunks):
        offset = chunk_idx * CHUNK_ROWS
        chunk_df = lf.slice(offset, CHUNK_ROWS).collect()

        rows_in_chunk = len(chunk_df)
        if rows_in_chunk == 0:
            if progress_callback:
                progress_callback(chunk_idx + 1, total_chunks)
            continue

        # Build stats for this chunk
        chunk_stats_rows = []

        # Numeric columns: min, max, null_count
        for col in numeric_cols:
            series = chunk_df[col]
            col_min = series.min()
            col_max = series.max()
            null_count = series.null_count()
            chunk_stats_rows.append({
                "column": col,
                "col_type": "numeric",
                "cat_value": None,
                "num_min": float(col_min) if col_min is not None else None,
                "num_max": float(col_max) if col_max is not None else None,
                "null_count": int(null_count),
            })

        # Categorical columns: unique values (capped), null_count
        for col in categorical_cols:
            series = chunk_df[col]
            null_count = series.null_count()
            try:
                unique_vals = series.drop_nulls().cast(pl.Utf8).unique().to_list()
                unique_vals = [str(v) for v in unique_vals if v != ""]
            except Exception:
                unique_vals = []

            # Write one row per unique value so we can dedup across chunks
            for val in unique_vals:
                chunk_stats_rows.append({
                    "column": col,
                    "col_type": "categorical",
                    "cat_value": val,
                    "num_min": None,
                    "num_max": None,
                    "null_count": int(null_count) if val == unique_vals[0] else 0,
                })

            # If no values, still record the column with null counts
            if not unique_vals:
                chunk_stats_rows.append({
                    "column": col,
                    "col_type": "categorical",
                    "cat_value": None,
                    "num_min": None,
                    "num_max": None,
                    "null_count": int(null_count),
                })

        # Free the chunk from memory immediately
        del chunk_df

        if chunk_stats_rows:
            stats_df = pl.DataFrame(chunk_stats_rows)

            # Append to temp Parquet on disk
            if temp_profile_path.exists():
                existing = pl.read_parquet(temp_profile_path)
                combined = pl.concat([existing, stats_df])
                del existing
                combined.write_parquet(temp_profile_path)
                del combined
            else:
                stats_df.write_parquet(temp_profile_path)
            del stats_df

        if progress_callback:
            progress_callback(chunk_idx + 1, total_chunks)

    # --- Final aggregation pass on the (small) temp profile Parquet ---
    profile_result = {"columns": {}, "total_rows": total_rows, "file_size": file_path.stat().st_size}

    if temp_profile_path.exists():
        raw = pl.read_parquet(temp_profile_path)

        # Aggregate numeric columns
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

        # Aggregate categorical columns — dedup values across chunks
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
        # Clean up temp file
        temp_profile_path.unlink(missing_ok=True)

    # Write final profile Parquet (small — just the aggregated stats)
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

    for col_name, filter_val in filters.items():
        if isinstance(filter_val, dict):
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
        elif isinstance(filter_val, list) and len(filter_val) > 0:
            # Categorical filter
            str_vals = [str(v) for v in filter_val]
            lf = lf.filter(pl.col(col_name).cast(pl.Utf8).is_in(str_vals))

    return lf.select(pl.len()).collect().item()
