"""Metadata stage: profile the active tables into metadata.json.

The chatbot supports multiple parquets at once — one "table" per file in
`data/`. Each upload adds or replaces a table; deletes remove one. With more
than one table loaded the LLM is expected to write code that joins / unions /
transforms across them as the question demands.

Table name == filename without the .parquet extension. Join keys are
auto-detected as columns whose name appears in two or more tables, and
surfaced in the prompt so the LLM doesn't have to guess.

The chatbot never sends the rows to the model — it sends this compact profile
instead. The profile is what lets the LLM write Polars code that references
real column names and real category values without ever seeing a row.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import polars as pl

_HERE = Path(__file__).resolve().parent
# backend/ -> data_chatbot_codex/ (the app folder; everything this app needs lives
# below it — backend/, frontend/, data/, output/ — so the app is self-contained
# and doesn't touch the project-wide input_folder/ or output_folder/).
APP_DIR = _HERE.parent
APP_DATA_DIR = APP_DIR / "data"
METADATA_PATH = _HERE / "metadata.json"

# Bump when the metadata shape changes so stale caches rebuild.
_VERSION = 3

# A string/bool column with at most this many distinct values gets its full
# value list inlined; beyond it, we inline only the top values by frequency.
_LOW_CARD_MAX = 60
_TOP_VALUES = 25

_INT = (pl.Int8, pl.Int16, pl.Int32, pl.Int64,
        pl.UInt8, pl.UInt16, pl.UInt32, pl.UInt64)
_FLOAT = (pl.Float32, pl.Float64)
_NUMERIC = _INT + _FLOAT

# Separator for flattening per-column aggregations into one row of results.
_SEP = "@@"


# ---------- table discovery ----------

def get_tables() -> dict[str, Path]:
    """Return {table_name: file_path} for every parquet in data/. Table name
    is the filename without the .parquet extension. Resolved at call time so
    uploads/deletes during a running server are picked up immediately on the
    next request."""
    if not APP_DATA_DIR.exists():
        return {}
    out: dict[str, Path] = {}
    for p in sorted(APP_DATA_DIR.glob("*.parquet")):
        out[p.stem] = p
    return out


def has_any_table() -> bool:
    """True iff at least one parquet sits in data/. Endpoints that touch the
    data short-circuit on False so the UI can prompt for upload."""
    return bool(get_tables())


def delete_table(name: str) -> bool:
    """Delete a table by name. Returns True if removed, False if not found."""
    tables = get_tables()
    p = tables.get(name)
    if p is None or not p.exists():
        return False
    p.unlink()
    return True


def _manifest_signature(tables: dict[str, Path]) -> list[list]:
    """Stable, JSON-encodable signature of the current table set used for
    cache invalidation — list of [name, mtime] pairs sorted by name."""
    return sorted(
        [name, p.stat().st_mtime] for name, p in tables.items()
    )


# ---------- per-column scalar pass ----------

def _scalar_pass(lf: pl.LazyFrame, schema) -> dict[str, Any]:
    """One streaming aggregation that yields every scalar stat for every column
    plus the total row count. Returns a flat {name@@stat: value} dict."""
    aggs: list[pl.Expr] = [pl.len().alias(f"__rows__{_SEP}n")]
    for name, dtype in schema.items():
        aggs.append(pl.col(name).count().alias(f"{name}{_SEP}count"))   # non-null
        aggs.append(pl.col(name).null_count().alias(f"{name}{_SEP}null"))
        aggs.append(pl.col(name).n_unique().alias(f"{name}{_SEP}unique"))
        if dtype in _NUMERIC:
            aggs.append(pl.col(name).sum().alias(f"{name}{_SEP}sum"))
            aggs.append(pl.col(name).mean().alias(f"{name}{_SEP}mean"))
            aggs.append(pl.col(name).median().alias(f"{name}{_SEP}median"))
            aggs.append(pl.col(name).min().alias(f"{name}{_SEP}min"))
            aggs.append(pl.col(name).max().alias(f"{name}{_SEP}max"))
            aggs.append((pl.col(name) == 0).sum().alias(f"{name}{_SEP}zeros"))
        if dtype in _FLOAT:
            aggs.append(pl.col(name).is_nan().sum().alias(f"{name}{_SEP}nan"))
        if dtype == pl.String:
            aggs.append((pl.col(name) == "").sum().alias(f"{name}{_SEP}blank"))
    return lf.select(aggs).collect(engine="streaming").row(0, named=True)


def _stat(flat: dict[str, Any], name: str, key: str) -> Any:
    return flat.get(f"{name}{_SEP}{key}")


def _as_int(v: Any) -> int | None:
    return int(v) if v is not None else None


def _as_float(v: Any) -> float | None:
    if v is None:
        return None
    f = float(v)
    return None if math.isnan(f) else f


def _stats_block(flat: dict[str, Any], name: str, dtype) -> dict[str, Any]:
    """The green-strip stats for one column. None where N/A for the dtype."""
    is_num = dtype in _NUMERIC
    return {
        "count": _as_int(_stat(flat, name, "count")),
        "sum": _as_float(_stat(flat, name, "sum")) if is_num else None,
        "mean": _as_float(_stat(flat, name, "mean")) if is_num else None,
        "median": _as_float(_stat(flat, name, "median")) if is_num else None,
        "unique": _as_int(_stat(flat, name, "unique")),
        "null": _as_int(_stat(flat, name, "null")),
        "nan": _as_int(_stat(flat, name, "nan")) if dtype in _FLOAT else None,
        "blank": _as_int(_stat(flat, name, "blank")) if dtype == pl.String else None,
        "zeros": _as_int(_stat(flat, name, "zeros")) if is_num else None,
    }


def _unique_values(lf: pl.LazyFrame, name: str) -> list[Any]:
    vals = (
        lf.select(pl.col(name).unique().drop_nulls())
          .collect(engine="streaming")[name]
          .to_list()
    )
    return sorted(vals, key=lambda v: str(v))


def _top_values(lf: pl.LazyFrame, name: str) -> list[Any]:
    return (
        lf.select(name)
          .drop_nulls()
          .group_by(name)
          .agg(pl.len().alias("_count"))
          .sort("_count", descending=True)
          .head(_TOP_VALUES)
          .collect(engine="streaming")[name]
          .to_list()
    )


# ---------- per-table profile ----------

def _profile_table(name: str, path: Path) -> dict[str, Any]:
    """Profile a single parquet. Same per-column shape as the previous
    single-table metadata, wrapped under `name`/`file`."""
    lf = pl.scan_parquet(path)
    schema = lf.collect_schema()
    flat = _scalar_pass(lf, schema)
    row_count = int(flat[f"__rows__{_SEP}n"])

    columns: list[dict[str, Any]] = []
    for col_name, dtype in schema.items():
        unique = _as_int(_stat(flat, col_name, "unique")) or 0
        null = _as_int(_stat(flat, col_name, "null")) or 0
        col: dict[str, Any] = {
            "name": col_name,
            "dtype": str(dtype),
            "stats": _stats_block(flat, col_name, dtype),
        }
        if dtype in _NUMERIC:
            col.update({
                "kind": "numeric",
                "min": _stat(flat, col_name, "min"),
                "max": _stat(flat, col_name, "max"),
                "mean": _as_float(_stat(flat, col_name, "mean")),
                "median": _as_float(_stat(flat, col_name, "median")),
                "null_count": null,
            })
        elif unique <= _LOW_CARD_MAX:
            col.update({
                "kind": "categorical",
                "n_unique": unique,
                "null_count": null,
                "values": _unique_values(lf, col_name),
            })
        else:
            col.update({
                "kind": "categorical_high",
                "n_unique": unique,
                "null_count": null,
                "top_values": _top_values(lf, col_name),
            })
        columns.append(col)

    return {
        "name": name,
        "file": path.name,
        "source_path": str(path),
        "source_mtime": path.stat().st_mtime,
        "row_count": row_count,
        "column_count": len(columns),
        "columns": columns,
    }


# ---------- join-key detection ----------

def _detect_join_keys(tables: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Columns whose name appears in two or more tables are likely join keys.
    Returns a list of {name, tables: [table_names]} sorted by how many tables
    contain the column (most-shared first), then alphabetically."""
    col_to_tables: dict[str, list[str]] = {}
    for t in tables:
        for col in t["columns"]:
            col_to_tables.setdefault(col["name"], []).append(t["name"])
    candidates = [
        {"name": name, "tables": sorted(names)}
        for name, names in col_to_tables.items()
        if len(names) >= 2
    ]
    candidates.sort(key=lambda c: (-len(c["tables"]), c["name"]))
    return candidates


# ---------- top-level metadata ----------

def build_metadata() -> dict[str, Any]:
    """Profile every table currently in data/ and return the multi-table
    metadata dict (also written to disk by ensure_metadata)."""
    tables_paths = get_tables()
    if not tables_paths:
        raise FileNotFoundError(
            f"no tables in {APP_DATA_DIR} — upload at least one parquet"
        )
    tables = [_profile_table(name, path) for name, path in tables_paths.items()]
    return {
        "version": _VERSION,
        "manifest_sig": _manifest_signature(tables_paths),
        "tables": tables,
        "join_keys": _detect_join_keys(tables),
        "table_count": len(tables),
        "total_rows": sum(t["row_count"] for t in tables),
    }


def ensure_metadata(force: bool = False) -> dict[str, Any]:
    """Return metadata, regenerating metadata.json only when the table set
    has changed (file added/removed/replaced) or the schema version bumped."""
    tables_paths = get_tables()
    if not tables_paths:
        raise FileNotFoundError(
            f"no tables in {APP_DATA_DIR} — upload at least one parquet"
        )
    sig = _manifest_signature(tables_paths)
    if not force and METADATA_PATH.exists():
        try:
            cached = json.loads(METADATA_PATH.read_text(encoding="utf-8"))
            if (cached.get("version") == _VERSION
                    and cached.get("manifest_sig") == sig):
                return cached
        except (json.JSONDecodeError, OSError):
            pass  # fall through and rebuild

    meta = build_metadata()
    METADATA_PATH.write_text(json.dumps(meta, indent=2, default=str), encoding="utf-8")
    return meta


def stats_for(lf: pl.LazyFrame) -> tuple[dict[str, dict[str, Any]], int]:
    """Compute the green-strip stats for an arbitrary (e.g. filtered) frame.
    Used by /api/preview's filtered-mode response."""
    schema = lf.collect_schema()
    flat = _scalar_pass(lf, schema)
    stats = {name: _stats_block(flat, name, dtype) for name, dtype in schema.items()}
    return stats, int(flat[f"__rows__{_SEP}n"])


def metadata_for_prompt() -> str:
    """Compact, human-readable rendering of the multi-table profile for the
    prompt body. Each table gets its schema + value samples; join keys are
    listed at the end."""
    meta = ensure_metadata()
    lines: list[str] = [
        f"Available tables ({meta['table_count']} total, "
        f"{meta['total_rows']:,} rows across all tables):"
    ]
    for t in meta["tables"]:
        lines.append("")
        lines.append(
            f"Table: {t['name']}  ({t['row_count']:,} rows, "
            f"{t['column_count']} columns, file: {t['file']})"
        )
        for col in t["columns"]:
            head = f"  - {col['name']} ({col['dtype']})"
            if col["kind"] == "numeric":
                lines.append(
                    f"{head}: min={col['min']}, max={col['max']}, "
                    f"mean={col['mean']}, median={col['median']}, "
                    f"nulls={col['null_count']}"
                )
            elif col["kind"] == "categorical":
                vals = ", ".join(str(v) for v in col["values"])
                lines.append(f"{head}: {col['n_unique']} distinct -> [{vals}]")
            else:  # categorical_high
                tops = ", ".join(str(v) for v in col["top_values"])
                lines.append(
                    f"{head}: {col['n_unique']:,} distinct; top: [{tops}]"
                )

    if meta["join_keys"]:
        lines.append("")
        lines.append(
            "Likely join keys (columns shared across two or more tables):"
        )
        for jk in meta["join_keys"]:
            lines.append(
                f"  - {jk['name']}: appears in {', '.join(jk['tables'])}"
            )
    return "\n".join(lines)


if __name__ == "__main__":
    meta = ensure_metadata(force=True)
    print(
        f"Wrote {METADATA_PATH} — {meta['table_count']} table(s), "
        f"{meta['total_rows']:,} total rows"
    )
