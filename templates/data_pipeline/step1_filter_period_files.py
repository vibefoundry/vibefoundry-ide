"""
Reads all transactions_*.parquet files (input_folder/ first, sample_data/
fallback) as a single multi-file dataset, drops zero-volume rows, and writes
the union to step1_filter_period_files.parquet.

Uses LazyFrame.sink_parquet() to stream the entire pipeline directly to disk —
the result is never materialized in Python memory. This is what keeps RAM
bounded on huge inputs (50GB+).

Polars rules per AGENTS.md Track 1:
  Rule 1: pl.scan_parquet (not read)
  Rule 2: .select([...]) immediately after scan
  Rule 3: .filter(...) before any join/group-by — pushed down to parquet reader
  Rule 5: pl.scan_parquet([list_of_paths]) for multi-file (lets Polars stream
          across files as one logical dataset; faster than per-file concat)

  Rule 4 variant: sink_parquet() instead of collect(streaming).write_parquet().
                  Same streaming engine, but the final frame never enters Python
                  memory — bounded RAM for arbitrarily large output.
"""
import os
import glob
import polars as pl
from rich.console import Console

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(SCRIPT_DIR)))
INPUT_FOLDER = os.path.join(PROJECT_DIR, "input_folder")
OUTPUT_FOLDER = os.path.join(PROJECT_DIR, "output_folder")
SAMPLE_DATA = os.path.join(SCRIPT_DIR, "sample_data")

SCRIPT_NAME = os.path.splitext(os.path.basename(__file__))[0]
TASK_NAME = os.path.basename(os.path.dirname(os.path.abspath(__file__)))
TASK_OUTPUT = os.path.join(OUTPUT_FOLDER, TASK_NAME)

RUN_FOLDER = os.environ.get("VF_RUN_FOLDER", TASK_OUTPUT)
os.makedirs(RUN_FOLDER, exist_ok=True)

KEEP_COLS = [
    "account_code", "brand", "variety", "size_ml",
    "channel", "account_tier", "region", "period", "cases",
]

input_files = sorted(glob.glob(os.path.join(INPUT_FOLDER, "transactions_*.parquet")))
source = "input_folder"
if not input_files:
    input_files = sorted(glob.glob(os.path.join(SAMPLE_DATA, "transactions_*.parquet")))
    source = "sample_data"
    print("[data] No transactions_*.parquet in input_folder/ — using sample_data/ fallback.")

if not input_files:
    raise SystemExit(
        "[data] No transactions_*.parquet found in input_folder/ or sample_data/."
    )

print(f"[data] Reading {len(input_files)} file(s) from {source}/ as one logical dataset")

console = Console()
out_path = os.path.join(RUN_FOLDER, f"{SCRIPT_NAME}.parquet")

with console.status("[cyan]Filtering rows where cases > 0 (streaming sink)…[/cyan]", spinner="dots"):
    (
        pl.scan_parquet(input_files)        # Rule 5
          .select(KEEP_COLS)                # Rule 2
          .filter(pl.col("cases") > 0)      # Rule 3 (pushed down to parquet reader)
          .sink_parquet(out_path)           # streams directly to disk, no Python frame
    )

# Row count from parquet metadata only — no data materialization.
kept_rows = pl.scan_parquet(out_path).select(pl.len()).collect().item()
console.print(f"  Kept {kept_rows:,} rows (cases > 0) → {out_path}")
