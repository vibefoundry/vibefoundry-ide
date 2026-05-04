"""
Reads step1's filtered transactions and writes one parquet per period for
downstream consumers. Each period is an independent write — naturally chunked
work where tqdm reports real progress.

Uses LazyFrame.sink_parquet() per partition so each period streams directly
to disk without materializing the partition's frame in Python — RAM stays
bounded by Polars' streaming chunk size, not by the largest partition's rows.

Polars rules per AGENTS.md Track 1:
  Rule 1: pl.scan_parquet (not read)
  Rule 2: .select([...]) immediately after scan
  Rule 3: .filter(pl.col("period") == p) is pushed down to the parquet reader
          so unmatched rows never enter RAM
  Rule 4 variant: sink_parquet() per partition — bounded RAM regardless of
                  partition size
"""
import os
import polars as pl
from tqdm import tqdm

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(SCRIPT_DIR)))
OUTPUT_FOLDER = os.path.join(PROJECT_DIR, "output_folder")

SCRIPT_NAME = os.path.splitext(os.path.basename(__file__))[0]
TASK_NAME = os.path.basename(os.path.dirname(os.path.abspath(__file__)))
TASK_OUTPUT = os.path.join(OUTPUT_FOLDER, TASK_NAME)

RUN_FOLDER = os.environ.get("VF_RUN_FOLDER", TASK_OUTPUT)
os.makedirs(RUN_FOLDER, exist_ok=True)

KEEP_COLS = [
    "account_code", "brand", "variety", "size_ml",
    "channel", "account_tier", "region", "period", "cases",
]

prev_path = os.path.join(RUN_FOLDER, "step1_filter_period_files.parquet")
out_dir = os.path.join(RUN_FOLDER, SCRIPT_NAME)
os.makedirs(out_dir, exist_ok=True)

# Discover periods in a single pass — don't materialize the whole frame.
periods = (
    pl.scan_parquet(prev_path)
      .select("period")
      .unique()
      .collect()
      .get_column("period")
      .sort()
      .to_list()
)

print(f"[data] Partitioning into {len(periods)} period file(s) → {out_dir}/")

total_written = 0
for period in tqdm(periods, desc="  Periods", unit="period", ncols=80, leave=True):
    out_path = os.path.join(out_dir, f"transactions_{period}.parquet")
    (
        pl.scan_parquet(prev_path)
          .select(KEEP_COLS)
          .filter(pl.col("period") == period)
          .sink_parquet(out_path)
    )
    # Row count from parquet metadata only — no data materialization.
    total_written += pl.scan_parquet(out_path).select(pl.len()).collect().item()

print(f"  Wrote {total_written:,} rows across {len(periods)} period file(s)")
