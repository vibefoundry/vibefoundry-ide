"""
Orchestrates the data_pipeline task. Runs each step as a subprocess with a
rich-styled banner, lets the step manage its own progress display (tqdm bar
for chunked work, rich.status spinner for streaming/monolithic work), times
each step, and prints a final pipeline summary.

Each step's progress mode is its own concern — the orchestrator only frames
boundaries, captures timing, and surfaces errors. Add or remove steps by
editing the `steps` list below.
"""
import os
import subprocess
import sys
import time

from rich.console import Console
from rich.panel import Panel
from rich.text import Text

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(SCRIPT_DIR)))
OUTPUT_FOLDER = os.path.join(PROJECT_DIR, "output_folder")
TASK_NAME = os.path.basename(SCRIPT_DIR)
RUN_FOLDER = os.path.join(OUTPUT_FOLDER, TASK_NAME)
os.makedirs(RUN_FOLDER, exist_ok=True)

steps = [
    "step1_filter_period_files.py",
    "step2_aggregate_by_brand.py",
    "step3_top_n_brands.py",
    "step4_partition_by_period.py",
]

console = Console()


def banner(title: str, subtitle: str = "", style: str = "cyan") -> None:
    text = Text(title, style=f"bold {style}")
    if subtitle:
        text.append("\n")
        text.append(subtitle, style="dim")
    console.print(Panel(text, border_style=style, padding=(0, 1)))


def fmt_time(seconds: float) -> str:
    if seconds < 60:
        return f"{seconds:.2f}s"
    mins, secs = divmod(seconds, 60)
    return f"{int(mins)}m {secs:.1f}s"


banner(
    f"{TASK_NAME} · Track 1 pipeline",
    f"Output → {RUN_FOLDER}",
    style="cyan",
)

total_start = time.perf_counter()
step_results = []

for i, step in enumerate(steps, start=1):
    script_path = os.path.join(SCRIPT_DIR, step)
    console.rule(f"[bold]▶ [{i}/{len(steps)}] {step}[/bold]", style="dim")

    env = os.environ.copy()
    env["VF_RUN_FOLDER"] = RUN_FOLDER
    env["PYTHONUNBUFFERED"] = "1"

    step_start = time.perf_counter()
    try:
        result = subprocess.run([sys.executable, script_path], env=env)
    except Exception as exc:  # noqa: BLE001
        elapsed = time.perf_counter() - step_start
        console.print(f"[bold red]✗ {step} crashed after {fmt_time(elapsed)}[/bold red]")
        console.print_exception()
        sys.exit(1)

    elapsed = time.perf_counter() - step_start
    if result.returncode != 0:
        console.print(
            f"[bold red]✗ {step} failed (exit {result.returncode}) after {fmt_time(elapsed)}[/bold red]"
        )
        sys.exit(result.returncode)

    console.print(f"[bold green]✓ {step}[/bold green] · [dim]{fmt_time(elapsed)}[/dim]")
    step_results.append((step, elapsed))

total_elapsed = time.perf_counter() - total_start
final_step_name = os.path.splitext(steps[-1])[0]
final_file = os.path.join(RUN_FOLDER, f"{final_step_name}.parquet")
final_dir = os.path.join(RUN_FOLDER, final_step_name)
if os.path.isfile(final_file):
    final_target = final_file
elif os.path.isdir(final_dir):
    final_target = final_dir + os.sep
else:
    final_target = RUN_FOLDER + os.sep

summary_lines = [f"[green]✓ Pipeline complete in {fmt_time(total_elapsed)}[/green]"]
for step, elapsed in step_results:
    summary_lines.append(f"  [dim]·[/dim] {step}  [dim]{fmt_time(elapsed)}[/dim]")
summary_lines.append("")
summary_lines.append(f"Final output → [bold]{final_target}[/bold]")
summary_lines.append(f"All step outputs → [dim]{RUN_FOLDER}{os.sep}[/dim]")

console.print()
console.print(Panel("\n".join(summary_lines), border_style="green", padding=(0, 1)))
