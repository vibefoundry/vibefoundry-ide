"""
Reads step2's brand-by-period aggregates and produces the top-10 brands by
combined cases across all periods. Outputs step3_top_n_brands.parquet.

Demonstrates: small monolithic operation progress (rich.status spinner).
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

TOP_N = 10
console = Console()
prev_path = os.path.join(RUN_FOLDER, "step2_aggregate_by_brand.parquet")
out_path = os.path.join(RUN_FOLDER, f"{SCRIPT_NAME}.parquet")

with console.status(f"[cyan]Selecting top {TOP_N} brands by total cases…[/cyan]", spinner="dots"):
    result = (
        pl.scan_parquet(prev_path)
          .select(["brand", "total_cases"])  # Rule 2: column-prune defensively
          .group_by("brand")
          .agg(pl.col("total_cases").sum().alias("total_cases_all_periods"))
          .sort("total_cases_all_periods", descending=True)
          .head(TOP_N)
          .collect(engine="streaming")
    )

result.write_parquet(out_path)
console.print(f"  Wrote top {result.height} brands → {out_path}")
