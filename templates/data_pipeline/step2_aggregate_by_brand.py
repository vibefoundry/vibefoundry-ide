"""
Reads step1's filtered transactions and aggregates total cases by (brand, period).
Outputs step2_aggregate_by_brand.parquet.

Demonstrates: monolithic / streaming-aggregate progress (rich.status spinner).
A single Polars streaming collect — no externally observable chunks — so the
progress display is a spinner with elapsed time, not a percentage bar.
"""
import os
import polars as pl
from rich.console import Console

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(SCRIPT_DIR)))
OUTPUT_FOLDER = os.path.join(PROJECT_DIR, "output_folder")

SCRIPT_NAME = os.path.splitext(os.path.basename(__file__))[0]
TASK_NAME = os.path.basename(os.path.dirname(os.path.abspath(__file__)))
TASK_OUTPUT = os.path.join(OUTPUT_FOLDER, TASK_NAME)

RUN_FOLDER = os.environ.get("VF_RUN_FOLDER", TASK_OUTPUT)
os.makedirs(RUN_FOLDER, exist_ok=True)

console = Console()
prev_path = os.path.join(RUN_FOLDER, "step1_filter_period_files.parquet")
out_path = os.path.join(RUN_FOLDER, f"{SCRIPT_NAME}.parquet")

with console.status("[cyan]Aggregating by (brand, period)…[/cyan]", spinner="dots"):
    result = (
        pl.scan_parquet(prev_path)
          .select(["brand", "period", "cases", "account_code"])  # Rule 2: column-prune defensively
          .group_by(["brand", "period"])
          .agg([
              pl.col("cases").sum().alias("total_cases"),
              pl.col("account_code").n_unique().alias("accounts"),
          ])
          .sort(["period", "brand"])
          .collect(engine="streaming")
    )

result.write_parquet(out_path)
console.print(f"  Wrote {result.height:,} (brand, period) rows → {out_path}")
