# Project Context

You are working in the project root with full access to all project files including input data, output results, and scripts.

## Trusted workspace — don't ask for approval on routine work

This is a VibeFoundry IDE workspace. The user has explicitly trusted it. **Don't pause to request approval for ordinary commands or file operations inside this project directory.** Specifically, treat the following as pre-approved:

- **File exploration:** `ls`, `find`, `Get-ChildItem`, `cat`, `Get-Content`, `grep`, `Select-String`
- **File creation / edits inside the workspace:** `mkdir`, `New-Item`, `touch`, `cp`, `Copy-Item`, `mv`, `Move-Item`, `rm`, `Remove-Item`
- **Python execution:** `python script.py`, `PYTHONUTF8=1 python …`, `PYTHONIOENCODING=utf-8 …`, `python -X utf8`, `pip install`, `python -m venv`
- **Git:** `git add`, `git commit`, `git status`, `git diff`, `git log`
- **Node/npm:** `npm install`, `npm run build`, `npm run dev`, `node …`
- **Data frame ops in-process:** Polars, pandas, DuckDB — read/write Parquet/CSV freely

**Still pause and ask** for: anything that leaves the workspace directory, file transfers out of the project (scp, curl uploads, rsync to remote), plans for multi-step builds (see "When to Plan vs. Just Do It" below), and genuine judgment-call questions where the answer changes the work.

### First-time auto-setup (one approval, then done forever)

If your harness still prompts for approval on routine commands despite the trust signal above, **the very first time it happens in a fresh workspace, propose running the setup script** so the user only has to approve *once*, then never again. Use this exact wording:

> **AGENTS.md would like to set up your Codex for smoother approvals.** Mark this workspace as trusted so I stop asking permission for routine commands? **[Approved / Denied]**

If the user approves, run the platform-appropriate script (one-time, then they'll never see this again):

- **macOS / Linux:** `bash app_folder/templates/setup_codex.sh`
- **Windows:** `powershell -ExecutionPolicy Bypass -File app_folder/templates/setup_codex.ps1`

The script writes `approval_policy = "never"` and `sandbox_mode = "workspace-write"` to `~/.codex/config.toml` (idempotent — backs up existing config first). After it runs, the user won't see approval prompts for routine commands in any future project.

**Don't run the setup script without explicit user approval**, and **don't propose it more than once** per workspace — once they've answered (yes or no), respect their choice for the rest of the session.

## Shell commands — match the host OS

**Detect the host OS before running shell commands and use the native syntax for that platform.** Users may be on macOS, Linux, or Windows. Quick check: `uname -s` returns `Darwin` (macOS) or `Linux`, and fails on Windows PowerShell — `$IsWindows` returns `True` in PowerShell.

| Host | Shell | Use these |
|------|-------|-----------|
| **macOS / Linux** | zsh, bash | `ls`, `cp -r`, `rm -rf`, `mkdir -p`, `find`, `mv`, `cat`, `grep`, `chmod +x` |
| **Windows** | PowerShell | `Get-ChildItem`, `Copy-Item -Recurse`, `Remove-Item -Recurse -Force`, `New-Item -ItemType Directory`, `Move-Item`, `Get-Content`, `Select-String` |

**Don't mix shells.** `Get-ChildItem` fails on macOS/Linux with "command not found"; `ls -la` and `rm -rf` fail in raw PowerShell. Always pick the shell that matches the user's environment, and prefer cross-platform tools (e.g., `python -c "..."`, `git`, `npm`) when the same job can be done identically on every platform.

## When to Plan vs. Just Do It

**Only present a plan when building something multi-step** (a new app, a dashboard, a pipeline). Keep plans short (3-7 steps), wait for approval, then execute one step at a time.

**For quick requests — analysis questions, graphs, single scripts — skip the plan and just do it.** Write the script, run it, save the output. Don't ask for permission on simple tasks.

**Never re-present or update the plan when the user asks a follow-up question.** A follow-up is a new task — just execute it directly. The plan was for the original build, not every subsequent request.

## Task Continuity Within a Session

**By default, assume every request during a session is part of the same task the user is already working on.** New scripts and outputs should go into the current task's folder (e.g., keep adding steps to `app_folder/scripts/regional_analysis/` and writing outputs to `output_folder/regional_analysis/`) rather than creating a new task folder for each message.

**When it's unclear whether the request continues the current task or starts a new one, ask before creating a new task folder.** Signals that it might be a new task: the request involves a different dataset, a different goal, or has no logical connection to what was just built. When in doubt, ask: *"Is this a continuation of the {current task name} task, or should I create a new task folder for it?"* — then proceed based on the answer.

## Which Track? — Pick One Before You Start

Every project falls into one of three tracks. **Pick the track before writing any code**, then follow that track's dedicated section below. The rules *above* this section (planning, task continuity, folder structure, "input is sacred") apply to all three tracks.

| Track | When to use | What it produces |
|---|---|---|
| **1. Python Scripts** | Data processing, analysis, cleaning, aggregation, visualization — anything that reads input, transforms it, writes output | `.parquet` / `.png` files in `output_folder/{task}/` |
| **2. Progressive Web App** (DuckDB-WASM + React) | Interactive dashboards or explorers over large static data, distributable as a zip-and-share folder that runs entirely in the user's browser | A self-contained folder in `output_folder/{app_name}/` with launcher scripts |
| **3. Full-Stack App** (React + Python backend) | Apps that need a live server at runtime — API calls, RAG/LLM, auth, mutations, external services, secrets | A running dev server pair (frontend + backend) with launcher scripts |

### How to pick

- **No user interaction beyond running the script?** → **Track 1**
- **Interactive UI, but all logic can run against static Parquet files in the browser?** → **Track 2**
- **Needs a server to exist at runtime** (external APIs, secrets, RAG, mutations, auth)? → **Track 3**

When the user's request is ambiguous (e.g., "build me a dashboard"), ask: *"Is this a static dashboard over existing Parquet data (PWA), or does it need a backend for live data / API calls (full-stack)?"* — then proceed based on the answer.

Once the track is chosen, only the sections for that track apply. Don't mix patterns across tracks (e.g., don't use Track 1's `app.py` + step naming for Track 3's backend, and don't create Track 3 launcher scripts for a Track 1 task).

## Folder Structure

```
project_folder/           <- You are here
├── AGENTS.md             <- This file (agent instructions — Claude Code, Codex, etc.)
├── input_folder/         <- Source data files
├── output_folder/        <- Scripts save results here
└── app_folder/
    ├── meta_data/        <- Metadata describing available data
    ├── templates/        <- Reusable boilerplates (copy into scripts/, then refactor)
    └── scripts/          <- Every app lives here (one folder per app)
```

### Everything goes under `app_folder/scripts/`

**ALL applications live in `app_folder/scripts/{app_name}/` — no exceptions.** This is the single source of truth for code, regardless of which track the app falls under:

- **Track 1 — Python scripts:** `app_folder/scripts/{task_name}/` contains `app.py` + `step1_*.py`, `step2_*.py`, etc.
- **Track 2 — PWA (DuckDB-WASM + React):** `app_folder/scripts/{app_name}/` contains the build script (`app.py`) **and** the PWA source files (`index.html`, `css/`, `js/`).
- **Track 3 — Full-Stack (React + Python backend):** `app_folder/scripts/{app_name}/` contains `backend/`, `frontend/`, and the launcher scripts (`setup.sh`/`run_app.sh`/`clear_cache.sh` + `.bat` equivalents).

**Never put app code at the top of `app_folder/`, at the project root, or anywhere outside `app_folder/scripts/`.** If you find yourself creating `app_folder/{app_name}/` or top-level `backend/` and `frontend/` folders, stop — move them under `app_folder/scripts/{app_name}/` instead. The only top-level folders allowed inside `app_folder/` are `scripts/`, `meta_data/`, and `templates/`.

### Launcher scripts — Track 2 and Track 3 only

| Track | Needs `run_app.sh` + `run_app.bat`? | Why |
|---|---|---|
| **Track 1 — Python pipeline** | **No.** Don't ship them. | `python app.py` is the canonical command; a launcher that just `cd`s and re-invokes the same line is redundant and clutters the task folder. Track 1 tasks also don't need a `README.md` — the `app.py` docstring + step docstrings are the documentation. |
| **Track 2 — PWA** | **Yes**, both required. | `run_app.sh` runs `python build_app_package.py` to rebuild the output package, then launches the corresponding OS launcher inside `output_folder/{app_name}/` (`mac_start.sh` or `pc_start.bat`) so the developer sees the freshly built app immediately. |
| **Track 3 — Full-Stack** | **Yes**, plus `setup.sh`/`.bat` and `clear_cache.sh`/`.bat`. | `run_app` reserves two free ports, then runs backend + frontend concurrently (see Track 3 launcher template below). |

For Track 2 and Track 3, both `.sh` files must be `chmod +x` by the build/setup process so they're executable. The `.bat` and `.sh` files always live alongside each other inside the task folder.

## Input Data Is Sacred — Never Edit It

**Never modify, overwrite, or delete any file in `input_folder/`.** This folder is read-only. Users drop their source data here and trust that it will never be touched.

All transformations, merges, cleaning, filtering, deduplication, reformatting, and any other processing must produce **new files in `output_folder/`** — never edit the originals. If a script needs "cleaned" data, it reads from `input_folder/`, cleans it, and writes the result to `output_folder/`. The input stays pristine.

This is a hard rule with no exceptions. Even if the user says "fix the data" or "clean the CSV," that means: read the input, transform it, and save the result as output. Never write back to `input_folder/`.

## Templates

Reusable boilerplates live in `app_folder/templates/{template_name}/`. They exist to be **copied into `app_folder/scripts/`, renamed, and refactored** for the specific task at hand — not to be edited in place.

### App-building method: template-first, then refactor

When creating a new app, dashboard, geospatial tool, or processing pipeline, **copy the closest appropriate template first, then refactor that copied app to meet the user's needs.** Do not build the scaffold from scratch when a local template or a template in this file matches the request.

Template selection order:

1. **Use local templates first.** Look in `app_folder/templates/` for the closest matching full-app template. Copy the entire template folder into `app_folder/scripts/{user_requested_or_reasonable_app_name}/`, then refactor the copied files there. Never edit the original template in `app_folder/templates/`.
2. **If no local full-app template exists, use the relevant template/scaffold in this file.** Create the task folder under `app_folder/scripts/{app_name}/`, copy the required structure from this file, then refactor it.
3. **Only create a scaffold manually when no matching template exists.** Even then, follow the closest track template in this file for folder layout, launchers, path handling, dynamic ports, packaging, and orchestration.

Category matching:

- **Geospatial dashboard or map app:** Copy the closest geospatial dashboard/map template first, then refactor data loading, spatial joins, map layers, filters, viewport defaults, legends, charts, and styling for the user's actual data and goal.
- **Dashboard or data explorer:** Copy the closest dashboard/explorer template first, then refactor datasets, DuckDB/Polars queries, charts, filters, KPIs, tables, and interactions.
- **Processing pipeline or analysis task:** Copy the closest Track 1 pipeline template first, then refactor `app.py` and `step*_*.py` so the steps perform the requested processing and write the required Parquet/PNG outputs.
- **Full-stack app:** Copy the closest React + Python backend template first, then refactor backend routes, frontend workflow, API contracts, and data processing while preserving setup/run/cache scripts and dynamic-port behavior.

The copied template is a starting application, not a final result. Preserve the proven operational plumbing: launcher scripts where required, dynamic-port logic, package structure, path handling, `VF_RUN_FOLDER`, fail-fast orchestration, and dependency checks. Replace or refactor the app-specific behavior: UI, routes, data queries, transformations, charts, map layers, copy, styling, and domain logic so the final app matches the user's request and the actual project data.

### How to use a template

1. **Pick the right one.** If a template's shape (Track 1 pipeline, Track 2 PWA, etc.) matches the user's ask, use it as a guide. Don't build from scratch when a template fits.

2. **How to "use" the template depends on which track:**

   **Track 1 (Python pipelines) — DO NOT FORK.** Track 1 templates are *reference material only*. Read the template's `app.py` and `step*_*.py` to understand the pipeline pattern (numbered steps, durable Parquet checkpoints, `app.py` orchestrator, no launchers, no README). Then **write the new task from scratch** in `app_folder/scripts/{task_name}/`, following that pattern but with code specific to the user's data and goal. **Never `cp -r` a Track 1 template into `scripts/`** — Track 1 work is too task-specific for a literal copy to be useful, and copying drags template-isms (variable names, fake schemas, dummy logic) into production code.

   **Track 2 (PWA) and Track 3 (Full-Stack) — fork the template, code only, no sample data.** These tracks ship a lot of operational plumbing (launcher scripts, build pipelines, port logic, package layout) that's worth preserving verbatim. Use one of these recipes to copy *only the code files*:
   ```bash
   # Option A: copy then drop sample_data
   cp -r app_folder/templates/{template_name} app_folder/scripts/{appropriate_new_name}
   rm -rf app_folder/scripts/{appropriate_new_name}/sample_data
   ```
   ```bash
   # Option B: rsync with exclude (single command)
   rsync -av --exclude='sample_data/' app_folder/templates/{template_name}/ app_folder/scripts/{appropriate_new_name}/
   ```
   The build/launcher scripts derive `APP_NAME` from the folder name automatically, so renaming the folder is usually all the rewiring needed. **Never carry the template's `sample_data/` into the new task folder** — real tasks must source data exclusively from `input_folder/`. (See "Template data is for examples only" below.)

3. **Refactor to fit.** Update titles, schema, sample fallbacks, and any hardcoded strings to match the user's domain. Don't keep generic-template language in a real task.

4. **Delete what doesn't fit.** If the template ships a feature the user didn't ask for (a chart, a pane, a step), **delete it** — don't leave it as dead weight. Fewer moving parts is better than carrying unused boilerplate.

### Template data is for examples only

Templates ship synthetic `sample_data/` (and sometimes pre-staged files in `public/data/`) so they run out of the box. **Never use that data for any real analysis.** It's illustrative — the schemas are realistic, the values aren't.

**When you fork a template into `app_folder/scripts/`, do not bring `sample_data/` with you.** Copy only the code files (Python, JS, HTML, configs, launcher scripts) — see step 2 above for the exact `rsync --exclude` / `rm -rf sample_data` recipes. The forked task should resolve its dataset from `input_folder/` on every run. Carrying the template's example data into a real task folder is how synthetic values end up in production outputs.

Real data always comes from:
- `input_folder/` (read-only source data — see the "Input Data Is Sacred" rule above)
- `output_folder/` (results from prior tasks)

When a forked template's build script resolves its dataset, the priority order is always:
1. `input_folder/{file}` — real data, wins
2. Existing staged file in the task's local data folder — preserved if real
3. `sample_data/` — fallback only, never overwrites real data

If a forked task is being used in production, swap the sample dataset for the real one via `input_folder/` before shipping — never rely on the template's example values reaching downstream consumers.

---

# Track 1: Python Scripts (Data Processing)

**Use this track for:** data processing, analysis, cleaning, aggregation, feature engineering, statistical analysis, visualizations — anything that reads data from `input_folder/`, transforms it, and writes results to `output_folder/{task}/`. The scripts can be run through the VibeFoundry IDE *or* via the mandated `run_app.sh`/`run_app.bat` launchers (see below — every task folder gets these regardless of track).

## Answering Questions About Data

When asked a question that requires analyzing the data — just do it, no plan needed:

1. **Always create a `.py` script** in `app_folder/scripts/` — never run analysis inline
2. Read the relevant input file(s) using **Polars** (not Pandas)
3. Perform the analysis
4. **Save the result as a `.parquet` file** to the task's output folder (REQUIRED — this is how results appear in the UI)
5. Run the script

## Graphs and Visualizations

When asked for a chart, graph, or visualization — just do it, no plan needed:

1. **Always create a `.py` script** in `app_folder/scripts/` — never run plotting inline
2. Use **matplotlib** or **plotly** to create the chart
3. **Save the image to the task's output folder** (e.g., `output_folder/{task}/step2_chart.png`)
4. Also save the underlying data as a `.parquet` file to the same folder so the next step (or the user) can read the numbers
5. Run the script

## Script Template

**Every `.py` file must start with a docstring** explaining what it does in 1-2 sentences:

```python
"""
Cleans the raw sales data by removing duplicates, fixing date formats,
and filtering out invalid entries. Outputs step1_clean_sales.parquet.
"""
```

**Use this path template** so scripts work from any directory:

```python
"""
Brief description of what this script does and what it outputs.
"""
import os
import polars as pl

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
# 3 levels up: scripts/{task}/ → scripts/ → app_folder/ → project_folder/
PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(SCRIPT_DIR)))
INPUT_FOLDER = os.path.join(PROJECT_DIR, "input_folder")
OUTPUT_FOLDER = os.path.join(PROJECT_DIR, "output_folder")
```

## Structuring Python Scripts

**Every task — simple or complex — must have both an `app.py` orchestrator AND at least one `step1_*.py` script.** `app.py` never contains its own work logic. `app.py` only orchestrates — it runs `step1_*.py`, `step2_*.py`, etc. in sequence. Even a "one-line" task has an `app.py` that calls a `step1_*.py` where the actual work lives.

### Orchestration is part of the processing methodology

The `app.py` template is not just boilerplate. It is the processing-control layer for RAM-conscious, restartable pipelines. Preserve and use its behavior deliberately:

- **Keep `app.py` lightweight.** It should not import Polars, read datasets, hold dataframes, create charts, or perform business logic. It only creates the run folder, sets `VF_RUN_FOLDER`, and runs step scripts.
- **Run each step as a separate Python process.** The subprocess pattern is intentional: when a step finishes, its process exits and releases memory before the next step starts.
- **Checkpoint every step to disk.** Each step writes its transformed dataset to Parquet in `output_folder/{task}/`. Downstream steps read that Parquet checkpoint instead of keeping upstream data in RAM.
- **Design step boundaries around expensive operations.** If a pipeline has a large clean, join, aggregation, model, or visualization stage, split it so the expensive stage writes a reusable Parquet output before the next stage begins.
- **Avoid oversized all-in-one steps.** Do not collapse independent cleaning, joining, aggregation, and visualization into one script if that would force multiple large dataframes to coexist in memory.
- **Rerun only what changed.** After edits, run the changed step and downstream steps only. This saves processing time and avoids re-reading/recomputing large upstream inputs unnecessarily.
- **Stop on failure.** Preserve `app.py`'s fail-fast behavior so downstream outputs are not regenerated from missing or stale upstream data.

Think of the pipeline as a sequence of durable, memory-releasing checkpoints: raw input → step1 Parquet → step2 Parquet → step3 output. This is the default processing methodology for Track 1 work.

**Multi-step tasks** (multiple outputs, transformations, or analyses) → break into separate `step1_*.py`, `step2_*.py`, ... scripts, each doing one job, chained together by the `app.py` orchestrator.

### When to split:

Each of the following is its own `.py` file — **never combine these into one script**:

- **Data transformations** — filtering, grouping, aggregating, pivoting, reshaping
- **Graph/chart creation** — any visualization gets its own script that reads a CSV and outputs an image
- **Merges/joins** — combining multiple datasets into one
- **Chunking/splitting** — breaking large files into smaller pieces
- **Data cleaning** — deduplication, fixing formats, handling nulls
- **Feature engineering** — creating new columns, calculations, derived fields
- **Modeling/analysis** — statistical analysis, ML training, scoring

If the user says "group by region and make a chart," that's **two scripts**: one to group and save the CSV, one to read that CSV and make the chart.

### File structure:

Every task gets its **own folder** inside `app_folder/scripts/`. The orchestrator is always named **`app.py`** and **only orchestrates** — it never contains work logic. The folder must always contain at least `app.py` + `step1_*.py`.

Example for "group by region and make a chart":

```
app_folder/scripts/
└── regional_analysis/
    ├── app.py                         <- Orchestrator — runs steps in order
    ├── step1_group_by_region.py       <- Groups data → saves aggregated parquet
    └── step2_chart.py                 <- Reads step1 parquet → creates chart image
```

Example for "clean, merge, analyze, and visualize":

```
app_folder/scripts/
└── sales_pipeline/
    ├── app.py                         <- Orchestrator — runs steps in order
    ├── step1_clean_data.py            <- Reads raw data → saves cleaned parquet
    ├── step2_merge_datasets.py        <- Reads step1 parquet → saves merged parquet
    ├── step3_analyze.py               <- Reads step2 parquet → saves analysis parquet
    └── step4_visualize.py             <- Reads step3 parquet → saves chart image
```

Even single-step tasks follow the same pattern — `app.py` orchestrates, `step1_*.py` does the work:

```
app_folder/scripts/
└── top_customers/
    ├── app.py                         <- Orchestrator — runs step1
    └── step1_top_customers.py         <- Reads input → saves top-customers parquet
```

### Key rule: every script produces output, every script reads from the previous step

The chain is always: **read input → do work → write output**. No script is "read-only."

- `step1` reads from `input_folder/`
- `step2` reads from `step1`'s output
- `step3` reads from `step2`'s output
- ...and so on

### The output of a step IS the transformed data — not a summary of it

**Every step's output must be the actual transformed data itself** — the filtered rows, the cleaned dataframe, the grouped/merged table, the feature-engineered dataset. It is **not** a summary, a `.describe()`, a row-count report, or a "here's what I did" metadata file. If step 2 reads step 1's output, step 1's output must be the real data step 2 needs — not stats describing that data.

**Never write validation/QC/summary files alongside the real output.** Don't produce `_qc.parquet`, `_summary.parquet`, or any "here's what changed" sidecar — just produce the transformed data and move on.

Examples of what the step output should be:
- `step1_clean_data.py` → `step1_clean_data.parquet` = the cleaned dataframe (every row, every column, after cleaning)
- `step1_filter_active.py` → `step1_filter_active.parquet` = the filtered rows themselves
- `step2_group_by_region.py` → `step2_group_by_region.parquet` = the grouped/aggregated dataframe
- `step3_merge_sales.py` → `step3_merge_sales.parquet` = the merged table

Examples of what the step output must **never** be (unless the task is literally "summarize the data"):
- `.describe()` stats, row counts, null counts, column types
- A report describing what changed
- A single-row summary of the transformation

### Output folder naming convention:

The `app.py` output folder is named after the **task folder**. All outputs — from simple tasks and multi-step tasks alike — go directly into the task's output folder. No subfolders per step.

- `app.py` (in `top_customers/`) → `output_folder/top_customers/`
- `app.py` (in `regional_analysis/`) → `output_folder/regional_analysis/`

No timestamps — each run overwrites the previous output.

**Step output files are named after their `.py` file** so they're easy to identify. **All tabular step outputs are `.parquet`** (not CSV). Chart/image outputs are `.png`.

- `step1_group_by_region.py` → `output_folder/regional_analysis/step1_group_by_region.parquet`
- `step2_chart.py` → `output_folder/regional_analysis/step2_chart.png`

#### Single-step task (e.g., `top_customers/app.py` running `step1_top_customers.py`):

```
output_folder/
└── top_customers/
    └── step1_top_customers.parquet
```

#### Multi-step task (e.g., `regional_analysis/app.py`):

All step outputs go directly into the task folder — no subfolders.

```
output_folder/
└── regional_analysis/
    ├── step1_group_by_region.parquet
    └── step2_chart.png
```

#### Single-step `app.py` example (`top_customers/app.py`):

Even for a one-step task, `app.py` only orchestrates — it runs `step1_top_customers.py` and does nothing else. The actual work lives in `step1_top_customers.py`.

```python
"""
Orchestrates the top_customers task — runs step1 to produce the top customers by revenue.
"""
import subprocess
import sys
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(SCRIPT_DIR)))
OUTPUT_FOLDER = os.path.join(PROJECT_DIR, "output_folder")

# Output folder named after the task folder
TASK_NAME = os.path.basename(SCRIPT_DIR)
RUN_FOLDER = os.path.join(OUTPUT_FOLDER, TASK_NAME)
os.makedirs(RUN_FOLDER, exist_ok=True)

steps = [
    "step1_top_customers.py",
]

for step in steps:
    script = os.path.join(SCRIPT_DIR, step)

    env = os.environ.copy()
    env["VF_RUN_FOLDER"] = RUN_FOLDER

    print(f"\n{'='*40}")
    print(f" Running {step}...")
    print(f"{'='*40}\n")
    result = subprocess.run([sys.executable, script], env=env)
    if result.returncode != 0:
        print(f"\nError in {step} — stopping.")
        sys.exit(1)

print(f"\n{'='*40}")
print(f" All steps complete! Output: {RUN_FOLDER}")
print(f"{'='*40}")
```

And `step1_top_customers.py` contains the actual work — **the output is the top-customer rows themselves, not a summary of them**:

```python
"""
Reads the sales data, sorts customers by revenue, and saves the top 10 rows.
Outputs step1_top_customers.parquet.
"""
import os
import polars as pl

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(SCRIPT_DIR)))
INPUT_FOLDER = os.path.join(PROJECT_DIR, "input_folder")
OUTPUT_FOLDER = os.path.join(PROJECT_DIR, "output_folder")

SCRIPT_NAME = os.path.splitext(os.path.basename(__file__))[0]
TASK_NAME = os.path.basename(os.path.dirname(os.path.abspath(__file__)))
TASK_OUTPUT = os.path.join(OUTPUT_FOLDER, TASK_NAME)

RUN_FOLDER = os.environ.get("VF_RUN_FOLDER", TASK_OUTPUT)
os.makedirs(RUN_FOLDER, exist_ok=True)

# Input files (from users) are typically CSV — read with scan_csv.
# All step outputs are parquet.
df = (
    pl.scan_csv(os.path.join(INPUT_FOLDER, "sales.csv"))
      .group_by("customer_id")
      .agg(pl.col("revenue").sum().alias("total_revenue"))
      .sort("total_revenue", descending=True)
      .head(10)
      .collect()
)
df.write_parquet(os.path.join(RUN_FOLDER, f"{SCRIPT_NAME}.parquet"))
print(f"Output saved to {RUN_FOLDER}")
```

#### Step script example (`step2_chart.py` — reads from previous step):

Step scripts **must work both ways**: run by `app.py` OR run individually. Use `os.environ.get()` with fallbacks — never `os.environ[]`. All step outputs go directly into the task's output folder (no subfolders), named after the `.py` file.

- **Run by `app.py`**: gets `VF_RUN_FOLDER` from env
- **Run individually**: writes to `output_folder/{task}/`

```python
"""
Reads the grouped regional data from step1 and creates a bar chart.
Outputs step2_chart.png.
"""
import os
import polars as pl
import matplotlib.pyplot as plt

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(SCRIPT_DIR)))
INPUT_FOLDER = os.path.join(PROJECT_DIR, "input_folder")
OUTPUT_FOLDER = os.path.join(PROJECT_DIR, "output_folder")

# All outputs go directly into the task's output folder
SCRIPT_NAME = os.path.splitext(os.path.basename(__file__))[0]
TASK_NAME = os.path.basename(os.path.dirname(os.path.abspath(__file__)))
TASK_OUTPUT = os.path.join(OUTPUT_FOLDER, TASK_NAME)

RUN_FOLDER = os.environ.get("VF_RUN_FOLDER", TASK_OUTPUT)
os.makedirs(RUN_FOLDER, exist_ok=True)

# Read previous step's output (named after its .py file)
prev_path = os.path.join(RUN_FOLDER, "step1_group_by_region.parquet")
df = pl.read_parquet(prev_path)

# Create chart — output named after this script
fig, ax = plt.subplots()
ax.bar(df["region"], df["total_sales"])
ax.set_title("Sales by Region")
fig.savefig(os.path.join(RUN_FOLDER, f"{SCRIPT_NAME}.png"), dpi=150, bbox_inches="tight")
plt.close(fig)
print(f"Chart saved to {RUN_FOLDER}")
```

#### Multi-step `app.py` example (`regional_analysis/app.py`):

```python
"""
Orchestrates the regional analysis pipeline:
step1 groups data by region, step2 creates a chart.
"""
import subprocess
import sys
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(SCRIPT_DIR)))
INPUT_FOLDER = os.path.join(PROJECT_DIR, "input_folder")
OUTPUT_FOLDER = os.path.join(PROJECT_DIR, "output_folder")

# Output folder named after the task folder — all step outputs go here
TASK_NAME = os.path.basename(SCRIPT_DIR)
RUN_FOLDER = os.path.join(OUTPUT_FOLDER, TASK_NAME)
os.makedirs(RUN_FOLDER, exist_ok=True)

steps = [
    "step1_group_by_region.py",
    "step2_chart.py",
]

for step in steps:
    script = os.path.join(SCRIPT_DIR, step)

    env = os.environ.copy()
    env["VF_RUN_FOLDER"] = RUN_FOLDER

    print(f"\n{'='*40}")
    print(f" Running {step}...")
    print(f"{'='*40}\n")
    result = subprocess.run([sys.executable, script], env=env)
    if result.returncode != 0:
        print(f"\nError in {step} — stopping.")
        sys.exit(1)

print(f"\n{'='*40}")
print(f" All steps complete! Output: {RUN_FOLDER}")
print(f"{'='*40}")
```

### Re-running after edits — run only what changed, not the whole pipeline

**When you add or edit a step, run only that step and the steps downstream of it. Do not re-run the entire pipeline via `app.py`.** The prior step outputs are already sitting in `output_folder/{task}/` (no timestamps — each run overwrites in place), so downstream steps can read them without re-running upstream work that didn't change.

- **Edited `step1_*.py`** → run `step1`, then all downstream steps (`step2`, `step3`, ...) since everything depends on step1's output
- **Edited `step3_*.py` in a 5-step pipeline** → run `step3`, `step4`, `step5` only (skip `step1`, `step2` — their outputs are unchanged)
- **Added a new `step4_*.py`** → run just `step4` (prior steps are already complete, and `app.py`'s `steps` list must also be updated so future full runs include it)

**Run steps individually** via their `.py` path:

```bash
python app_folder/scripts/regional_analysis/step3_analyze.py
```

Step scripts work standalone because they use `os.environ.get("VF_RUN_FOLDER", TASK_OUTPUT)` — when run directly, they write to `output_folder/{task}/` just like `app.py` would.

**Only run the full pipeline (`python app.py`) when:**
- The user explicitly asks for it ("run the full pipeline", "run app.py", "rerun from scratch")
- The task is new and no prior outputs exist yet
- You edited `step1` (in which case every step downstream runs anyway, so running `app.py` is equivalent)

### Rules:

- **Every task gets its own folder** inside `app_folder/scripts/` containing **at minimum** an `app.py` + a `step1_*.py`
- **`app.py` is always an orchestrator — never contains work logic.** It only runs `step1_*.py`, `step2_*.py`, ... in sequence. Even single-step tasks follow this pattern. The actual reading, transforming, and writing always lives in `step*_*.py` files.
- **Step files are required** — every task must have at least `step1_*.py`. Name steps with a numbered prefix so execution order is obvious (`step1_`, `step2_`, etc.)
- **Every script produces output** — no script is read-only
- **A step's output IS the transformed data** — the cleaned/filtered/grouped/merged dataframe itself, not a summary. Output a `.describe()` or row-count file only if the task is literally "summarize the data."
- **No QC/validation/summary sidecar files.** Don't write `_qc`, `_summary`, or "here's what changed" files alongside step outputs. Each step produces exactly one data output (plus a chart image if it's a visualization step).
- **All tabular outputs are `.parquet`** — use `df.write_parquet()` for every step output. Chart/image outputs are `.png`. Do not write step outputs as `.csv`.
- **Read intermediate step outputs with `pl.read_parquet()` / `pl.scan_parquet()`.** Read raw user input files from `input_folder/` with whatever format the user provided (typically `pl.scan_csv()`).
- **All outputs go directly into the task's output folder** — no subfolders per step. `output_folder/{task}/` is flat.
- **Step output files are named after their `.py` file** (e.g., `step1_group_by_region.py` → `step1_group_by_region.parquet`)
- **Never use `os.environ[]`** — always use `os.environ.get()` with a fallback so step scripts work with or without `app.py`
- **No timestamps** — each run overwrites the previous output
- **Output folder naming**: uses the task folder name (e.g., `regional_analysis/` → `output_folder/regional_analysis/`)
- Orchestrator naming: always **`app.py`** — the task folder name provides the context
- `app.py` passes `VF_RUN_FOLDER` env var to each step (the task's output folder)
- Steps read previous step outputs by filename (e.g., `step1_group_by_region.parquet`) from the same folder they write to
- `app.py` runs steps in sequence and stops on failure
- **After editing/adding a step, re-run only the changed step and its downstream steps** — not the whole pipeline. Run `app.py` only when the user explicitly asks for a full rerun, when the task is brand new, or when `step1` was edited.
- `PROJECT_DIR` must account for the extra folder depth: `os.path.dirname()` x3 from `scripts/{task}/`
- Don't over-split — if two things are tightly coupled and under 150 lines total, keep them in the same step file

## Polars Rules

- Use `pl.scan_csv()` / `pl.scan_parquet()` for lazy loading — NOT `pl.read_csv()`
- Chain lazy operations, call `.collect()` only at the end
- Only fall back to Pandas if a specific library requires it

### Scaling beyond memory

When inputs (or intermediate results) won't fit in RAM, the default `lf.collect(engine="streaming").write_parquet(path)` still materializes the final frame in Python before writing — which can freeze the machine on multi-GB outputs. Levers, in order of cost:

- **`lf.sink_parquet(path)`** — replaces `collect(streaming).write_parquet(path)` for steps where output size scales with input. Same query plan, but the result never enters Python memory. Bounded RAM regardless of output size. Use this in any step doing scan → filter → write or scan → group-by → write where the output could be GB-scale. Caveat: not every query shape has a streaming-sink path yet (complex joins, certain pivots, some window functions still fall back to in-memory collect). Polars warns when that happens — watch for it.
- **`POLARS_TEMP_DIR=/path/to/fast/ssd`** — env var that tells Polars where to spill sort and group-by intermediates if streaming can't bound them in RAM. Point at fast SSD, not network storage.
- **Manual partition-loop chunking** — when a high-cardinality group-by still OOMs even with streaming, partition by the group key and process one chunk at a time inside a `for` loop, using `sink_parquet` per partition. Per-partition RAM is bounded by Polars' streaming chunk size, not the partition's row count. (See `data_pipeline/step4_partition_by_period.py` for the canonical pattern.)
- **DuckDB instead of Polars** — for multi-100-GB joins or complex SQL on huge data, DuckDB's query engine has more mature disk-spilling on join-heavy workloads. Reads the same parquet files; consider it the escalation path when Polars streaming + spill aren't enough.

## Track 1 — No launcher scripts, no README

Track 1 tasks **don't ship `run_app.sh` / `run_app.bat`** and **don't ship a `README.md`**. The canonical command is `python app.py` — a launcher that wraps that line is pure clutter. The `app.py` docstring plus the per-step docstrings are the documentation; if you need more context, write a clearer docstring rather than a sidecar README.

A Track 1 task folder is just: `app.py` + `step1_*.py` (+ `step2_*.py`, etc.) + an optional `sample_data/` for templates. Nothing else.

---

# Track 2: Progressive Web Apps (DuckDB-WASM + React)

**Use this track when the user wants:** an interactive dashboard or data explorer that ships as a zip-and-share folder and runs entirely in the user's browser. No Python or Node.js on the user's machine — just a browser and a tiny local HTTP server that serves static files.

These apps are distributed as folders users launch with a `.bat` (Windows) or `.command` (Mac) file. No IT involvement required on the user's machine.

## Architecture (PWA)

- **DuckDB-WASM** — runs SQL queries on Parquet files directly in the browser
- **React 18 UMD** — UI framework loaded via `<script>` tags (no JSX, no build tools on user's machine)
- **Local HTTP server** — PowerShell `HttpListener` on Windows, `python3 -m http.server` on Mac
- **No backend** — everything runs client-side. The HTTP server only serves static files.

### Why a local HTTP server?

Browsers block `fetch()`, Workers, and WASM loading from `file://` URLs due to security restrictions. A local HTTP server makes all browser APIs work correctly. The launcher scripts find an available port at startup and open the browser to that URL — never hardcode a port.

## PWA Folder Structure

### Source (what you edit)

```
app_folder/
└── scripts/
    └── {app_name}/                     <- Everything for this app lives here
        ├── build_app_package.py        <- Build script (creates the output folder)
        └── src/                        <- PWA source files
            ├── index.html              <- Entry point
            ├── css/styles.css          <- Styles
            └── js/app.js               <- React app (plain JS, no JSX)
```

The build script is **always named `build_app_package.py`**. It reads from its sibling `src/` folder and creates the distributable folder at `output_folder/{app_name}/` (the script `os.makedirs(..., exist_ok=True)` it itself — never expect the folder to exist beforehand). Both the source and the build script live together inside `app_folder/scripts/{app_name}/` — never at the top of `app_folder/`.

### Output (what gets distributed)

The recipient sees only **four things** at the top of the package — three launchers and a single folder containing everything else. This keeps the user experience friendly: the recipient doesn't see a wall of files they don't recognize.

```
output_folder/
└── {app_name}/                             <- Distributable folder (zip and share this)
    ├── pc_start.bat                        <- Windows: double-click
    ├── mac_start.command                   <- Mac: double-click (Finder opens in Terminal)
    ├── mac_start.sh                        <- Mac: run from Terminal (`bash mac_start.sh`)
    └── application_files/                  <- Everything else lives here
        ├── index.html
        ├── css/styles.css
        ├── js/app.js
        ├── lib/
        │   ├── react.min.js                <- React 18 UMD production build
        │   ├── react-dom.min.js            <- ReactDOM 18 UMD production build
        │   ├── duckdb-bundle.js            <- DuckDB-WASM bundled with esbuild
        │   ├── duckdb-eh.wasm              <- DuckDB WASM binary (~35 MB)
        │   └── duckdb-browser-eh.worker.js <- DuckDB Web Worker
        ├── data/
        │   ├── manifest.json               <- Lists all Parquet files
        │   └── *.parquet                   <- Data files from input_folder/
        └── serve.ps1                       <- PowerShell HTTP server (called by pc_start.bat)
```

**Top-level rule:** the package's top level contains exactly `pc_start.bat`, `mac_start.command`, `mac_start.sh`, and `application_files/`. **Nothing else.** All assets, data, and helper scripts live inside `application_files/`. Every launcher file `cd`s into `application_files/` before doing anything.

**Why ship both `mac_start.command` and `mac_start.sh`?** They contain the same bash logic — only the extension differs:
- **`.command`** is the double-click path. Finder opens it in Terminal automatically. Recipients hit a Gatekeeper "macOS cannot verify the developer" prompt on first launch — they right-click → Open the first time, double-click thereafter.
- **`.sh`** is the Terminal-only path. Power users (or anyone who hits a stuck Gatekeeper block on Sequoia) can run `bash mac_start.sh` from Terminal and skip the prompt entirely.

The build script must `chmod +x` both Mac files so they're executable.

## Build Script Template

The build script (`app_folder/scripts/{app_name}/build_app_package.py`) runs on the **developer's machine** (requires Node.js for the one-time esbuild step). It creates `output_folder/{app_name}/` (`os.makedirs(..., exist_ok=True)`), reads source files from its sibling `src/` folder, and writes the distributable contents into the new folder.

### What the build script does (5 steps):

1. **Bundle DuckDB-WASM** — `npm install @duckdb/duckdb-wasm esbuild` in a temp dir, bundle with esbuild into a single IIFE script, copy the `.wasm` and worker files into `application_files/lib/`
2. **Download React** — fetch React 18 UMD production builds from unpkg CDN into `application_files/lib/`
3. **Copy app files** — `index.html`, `css/styles.css`, `js/app.js` from `app_folder/scripts/{app_name}/src/` into `application_files/`
4. **Copy Parquet data + generate manifest** — copy all `.parquet` files from `input_folder/` into `application_files/data/`, write `application_files/data/manifest.json`
5. **Create launcher scripts at the package top level** — `pc_start.bat`, `mac_start.command`, `mac_start.sh` (the three launchers); `serve.ps1` goes inside `application_files/` since it's invoked by `pc_start.bat`. The build script must `os.chmod(..., 0o755)` on `mac_start.command` and `mac_start.sh` so they're executable.

### esbuild bundling approach:

```python
# Create entry point that re-exports duckdb-wasm to window.duckdb
entry = "import * as duckdb from '@duckdb/duckdb-wasm';\nwindow.duckdb = duckdb;\n"

# Bundle as IIFE for browser
# npx esbuild entry.js --bundle --format=iife --outfile=duckdb-bundle.js --platform=browser --target=es2020
```

This produces a single `duckdb-bundle.js` that exposes `window.duckdb` — no ES module imports needed.

### manifest.json format:

```json
{
  "datasets": [
    {"displayName": "Human Readable Name", "filename": "actual_file.parquet"}
  ]
}
```

The `displayName` is derived from the filename with `.parquet` stripped. The app reads this manifest to discover available datasets.

## HTML Template

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{App Title}</title>
    <link rel="stylesheet" href="css/styles.css">
</head>
<body>
    <div id="root">
        <div class="initial-loading">
            <div class="spinner"></div>
            <p>Loading {App Title}...</p>
        </div>
    </div>

    <script src="lib/react.min.js"></script>
    <script src="lib/react-dom.min.js"></script>
    <script src="lib/duckdb-bundle.js"></script>
    <script src="js/app.js"></script>
</body>
</html>
```

**Script load order matters:** React first, then ReactDOM, then DuckDB bundle, then app code. All are plain `<script>` tags — no `type="module"`.

## JavaScript Patterns

### No JSX — use React.createElement

Since there's no build step on the user's machine, all React code uses `React.createElement` directly:

```javascript
(function () {
  "use strict";

  var useState = React.useState;
  var useEffect = React.useEffect;
  var h = React.createElement;  // shorthand

  // h("div", { className: "my-class" }, "Hello")
  // h("div", null, h("span", null, "nested"))
  // h(MyComponent, { prop: value })
})();
```

Wrap everything in an IIFE to avoid polluting the global scope.

### DuckDB initialization

```javascript
async function initDuckDB() {
    var baseUrl = new URL(".", window.location.href).href;
    var worker = new Worker(baseUrl + "lib/duckdb-browser-eh.worker.js");
    var logger = new window.duckdb.ConsoleLogger();
    var db = new window.duckdb.AsyncDuckDB(logger, worker);
    await db.instantiate(baseUrl + "lib/duckdb-eh.wasm");
    return db;
}
```

**Critical:** Use absolute URLs derived from `window.location.href` for the worker and WASM files. Relative paths fail because the Worker resolves them from its own location.

### Loading Parquet data

```javascript
async function loadDatasets(db) {
    var resp = await fetch("data/manifest.json");
    var manifest = await resp.json();
    var datasets = manifest.datasets;

    for (var i = 0; i < datasets.length; i++) {
        var ds = datasets[i];
        var dataResp = await fetch("data/" + ds.filename);
        var buffer = new Uint8Array(await dataResp.arrayBuffer());
        await db.registerFileBuffer(ds.filename, buffer);
    }

    return datasets;
}
```

Each Parquet file is fetched, loaded into a `Uint8Array`, and registered with DuckDB. After registration, you can query it with SQL: `SELECT * FROM read_parquet('filename.parquet')`.

### Querying with SQL

```javascript
// Get column info
var result = await conn.query("DESCRIBE SELECT * FROM read_parquet('file.parquet')");

// Paginated query with filters
var sql = "SELECT * FROM read_parquet('file.parquet') WHERE col ILIKE '%term%' ORDER BY col ASC LIMIT 50 OFFSET 100";
var result = await conn.query(sql);

// Reading results
for (var i = 0; i < result.numRows; i++) {
    var value = result.getChild("column_name").get(i);
}
```

### Filter patterns

| Column type | Filter UI | SQL pattern |
|---|---|---|
| String (<=80 unique values) | Dropdown | `WHERE "col" = 'value'` |
| String (>80 unique values) | Text input | `WHERE "col" ILIKE '%term%'` |
| Numeric | Text input with operators | `WHERE "col" > 100` (supports `>`, `<`, `>=`, `<=`, `=`, `!=`) |
| Boolean | Dropdown (All/True/False) | `WHERE "col" = true` |

Use debounced text inputs (350ms) so queries don't fire on every keystroke.

### Determining filter type at load time

When a dataset is selected, count distinct values for each string column:

```javascript
var cntResult = await conn.query(
    'SELECT COUNT(DISTINCT "' + colName + '") AS cnt FROM read_parquet(\'' + filename + "')"
);
var cnt = Number(cntResult.getChild("cnt").get(0));
if (cnt <= 80) {
    // Use dropdown — fetch the distinct values
} else {
    // Use text input
}
```

## PWA Launcher Scripts

All launchers sit at the package top level. They `cd` into `application_files/` before doing any work — the user never sees `application_files/` referenced in the launcher path, just the launcher name.

### Windows: pc_start.bat (top level) + serve.ps1 (inside application_files/)

`pc_start.bat` launches the PowerShell HTTP server. `serve.ps1` finds an available port at startup, prints the URL, and opens the browser itself — `pc_start.bat` does not hardcode any port:

```batch
@echo off
echo ========================================
echo  {App Title}
echo ========================================
echo.
echo Starting server on an available port...
echo Close this window to stop the server.
echo.
cd /d "%~dp0application_files"
powershell -ExecutionPolicy Bypass -File "serve.ps1"
```

Inside `serve.ps1` (which lives at `application_files/serve.ps1`), find a free port by binding a `TcpListener` to port 0 (the OS picks one), close the listener, then start `HttpListener` on that port and `Start-Process` the URL:

```powershell
# Pick any free port
$probe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$probe.Start()
$port = $probe.LocalEndpoint.Port
$probe.Stop()

$url = "http://localhost:$port/"
Write-Host "Serving on $url"
Start-Process $url

$http = [System.Net.HttpListener]::new()
$http.Prefixes.Add($url)
$http.Start()
# ... request loop ...
```

`serve.ps1` is a PowerShell HTTP server using `System.Net.HttpListener`. It must serve these MIME types:

| Extension | MIME type |
|---|---|
| `.html` | `text/html; charset=utf-8` |
| `.js` | `application/javascript` |
| `.css` | `text/css` |
| `.json` | `application/json` |
| `.wasm` | `application/wasm` |
| `.parquet` | `application/octet-stream` |

**The `.wasm` MIME type is critical.** Without `application/wasm`, browsers refuse to compile the WASM binary.

### Mac: mac_start.command + mac_start.sh (both at top level)

Both files contain **identical bash logic** — only the extension differs. Ship both. The build script must `os.chmod(path, 0o755)` on each so they're executable. The first thing each script does is **strip `com.apple.quarantine` from the entire package folder** — this is the Mac equivalent of Windows "Unblock", and it means after one successful run, future double-clicks work without any Gatekeeper prompt:

```bash
#!/bin/bash
PACKAGE_DIR="$(cd "$(dirname "$0")" && pwd)"

# Strip quarantine from the whole package — Mac equivalent of Windows "Unblock".
# After this runs once, double-clicking mac_start.command works with no prompt.
xattr -dr com.apple.quarantine "$PACKAGE_DIR" 2>/dev/null

cd "$PACKAGE_DIR/application_files"
echo "========================================"
echo " {App Title}"
echo "========================================"
echo ""
# Pick any free port — bind to 0, OS assigns one, close immediately
PORT=$(python3 -c "import socket; s=socket.socket(); s.bind(('127.0.0.1', 0)); print(s.getsockname()[1]); s.close()")
echo "Starting on http://localhost:$PORT"
echo "Press Ctrl+C to stop."
echo ""
open "http://localhost:$PORT"
python3 -m http.server "$PORT"
```

**Why ship both extensions?**

- **`mac_start.command`** — for double-clicking in Finder (opens in Terminal automatically). After the first successful run via either launcher has stripped quarantine, this just works.
- **`mac_start.sh`** — the **unblock entry point**. The user right-clicks it → **Open With** → **Terminal** → clicks **Open** in the Gatekeeper dialog. This bypasses Gatekeeper *and* runs the `xattr -dr` line, which strips quarantine from every file in the package. From then on, plain double-click on `mac_start.command` works without prompts.

This gives Mac users the same workflow Windows users have with right-click → Unblock: a one-time "open this once to unblock everything" step, then frictionless double-clicks forever after.

## Distribution

### Packaging

The build script outputs everything to `output_folder/{app_name}/`. Zip this entire folder to distribute:

```bash
cd output_folder && zip -r {app_name}.zip {app_name}/
```

### User instructions (include in a README.txt or email)

**Windows:**
1. Right-click the `.zip` file → **Properties** → check **Unblock** → **Apply**
2. Extract the zip
3. Double-click `pc_start.bat`

**Mac:**
1. Extract the zip
2. **First-time unblock:** right-click `mac_start.sh` → **Open With** → **Terminal**. macOS will warn you ("cannot verify the developer") — click **Open**. The script runs once, strips the quarantine flag from every file in the package, and launches the app. This is the Mac equivalent of Windows right-click → Unblock.
3. **Every time after:** just double-click `mac_start.command`. No prompts — quarantine is gone.
4. **If macOS Sequoia blocks even right-click → Open** (rare): go **System Settings** → **Privacy & Security** → click **Open Anyway** for `mac_start.sh`, then repeat step 2.

### Mark of the Web (MOTW) — Windows

Files downloaded from the internet (SharePoint, OneDrive, email) get tagged with MOTW by Windows. This prevents `.bat` files from running. **The user must unblock the zip before extracting.** Unblocking the zip before extraction ensures all extracted files are clean.

Alternative: if users have 7-Zip installed, it strips MOTW automatically during extraction.

### Gatekeeper / Quarantine — Mac

Mac equivalent of MOTW. Downloaded zip files extract with a `com.apple.quarantine` attribute on every file inside, which makes Gatekeeper block executables on first launch. There's no clean "Unblock" option in Finder like Windows has. The two ways past it:

1. **Right-click → Open** on `mac_start.command` (instead of double-click) on first launch — Gatekeeper shows the warning but offers an **Open** button. Once approved, future double-clicks work normally.
2. **Run `mac_start.sh` from Terminal** — `bash mac_start.sh`. Bypasses the Finder-level Gatekeeper prompt, though the script's first execution can still trigger a warning depending on macOS version.

The only way to skip these prompts entirely is to code-sign and notarize with an Apple Developer ID ($99/yr). Not worth it for internal distribution — just include the right-click → Open instruction in your README.

## Performance Notes

- **DuckDB-WASM** handles millions of rows efficiently — it queries Parquet files using columnar scans, not loading everything into memory at once
- **All Parquet files are loaded into browser memory** via `registerFileBuffer` at startup. For 86 MB of Parquet data, expect ~3-5 seconds to load
- **Pagination is essential** — never try to render all rows. Use `LIMIT/OFFSET` in SQL and keep page size small (50 rows)
- **Debounce filter inputs** — 350ms delay before firing a query prevents UI freezes during typing
- **COUNT DISTINCT for filter dropdowns** — run these once when switching datasets, not on every filter change

## Data-Heavy and Geospatial Apps

This architecture supports data-heavy apps (geospatial, large analytics, dashboards) as long as you follow one principle: **query first, render later.** DuckDB does the heavy lifting in SQL — the UI only touches the reduced result.

### The pattern

```
[Parquet files in DuckDB]  →  SQL query (filter, aggregate, join)  →  small result  →  render
         millions of rows         happens in WASM, fast                  hundreds       map/chart/table
```

Never pass raw data to a visualization library. Always reduce first:

```javascript
// BAD — sends 5M points to the map
var all = await conn.query("SELECT lat, lon FROM read_parquet('locations.parquet')");
map.addPoints(all);  // browser freezes

// GOOD — aggregate to grid, render summary
var grid = await conn.query(`
    SELECT ROUND(lat, 2) AS grid_lat,
           ROUND(lon, 2) AS grid_lon,
           COUNT(*) AS density
    FROM read_parquet('locations.parquet')
    WHERE region = 'Northeast'
    GROUP BY grid_lat, grid_lon
`);
map.addHeatmap(grid);  // hundreds of points, instant
```

### Visualization libraries (all work as UMD/CDN scripts)

| Library | Use case | UMD available |
|---|---|---|
| **Leaflet** | Maps — lightweight, tile-based | Yes |
| **deck.gl** | Maps — heavy data viz, WebGL, large point clouds | Yes |
| **Chart.js** | Bar, line, pie, scatter charts | Yes |
| **Observable Plot** | Statistical/analytical charts | Yes |
| **D3** | Custom/complex visualizations | Yes |

Add them the same way as React — download the UMD build in the build script and include via `<script>` tag. No npm on the user's machine.

### DuckDB spatial extension

DuckDB has a `spatial` extension for geometry operations:

```javascript
// Load the extension at startup
await conn.query("INSTALL spatial");
await conn.query("LOAD spatial");

// Then use ST_* functions in queries
var result = await conn.query(`
    SELECT name, ST_Distance(
        ST_Point(lon, lat),
        ST_Point(-73.985, 40.748)
    ) AS dist_km
    FROM read_parquet('stores.parquet')
    WHERE ST_DWithin(
        ST_Point(lon, lat),
        ST_Point(-73.985, 40.748),
        0.05
    )
    ORDER BY dist_km
    LIMIT 50
`);
```

**Note:** The spatial extension WASM file (~2 MB) downloads on first `INSTALL`. For offline distribution, you may need to bundle it — or ensure users have internet on first launch.

### Browser memory limits

| Data size (Parquet) | Approx. memory | Load time | Feasibility |
|---|---|---|---|
| < 100 MB | ~200-400 MB | 3-5 sec | No issues |
| 100-500 MB | ~500 MB - 1.5 GB | 10-30 sec | Works on most machines |
| 500 MB - 1 GB | 1.5-3 GB | 30-60 sec | Risky — may hit tab limits |
| > 1 GB | 3+ GB | 60+ sec | Likely fails — need different approach |

For datasets over 500 MB, consider:
- **Partitioning** — split into multiple smaller Parquet files, only load what's needed
- **Lazy loading** — don't `registerFileBuffer` all files at startup; load on demand when the user navigates to that dataset
- **Pre-aggregation** — run a build-time script to create summary Parquet files (e.g., daily to monthly rollups) and ship those instead of raw data

### Lazy loading pattern

Instead of loading all Parquet files at startup, load on demand:

```javascript
var loadedFiles = {};

async function ensureLoaded(db, filename) {
    if (loadedFiles[filename]) return;
    var resp = await fetch("data/" + filename);
    var buffer = new Uint8Array(await resp.arrayBuffer());
    await db.registerFileBuffer(filename, buffer);
    loadedFiles[filename] = true;
}

// Only load when user selects this dataset
async function onDatasetSelect(db, dataset) {
    showLoadingSpinner();
    await ensureLoaded(db, dataset.filename);
    hideLoadingSpinner();
    // Now query it
}
```

### Pre-aggregation in the build script

For dashboards that don't need row-level detail, create summary files at build time:

```python
# In build script (app.py) — runs on developer's machine with full Polars
import polars as pl

raw = pl.scan_parquet("input_folder/sales.parquet")

# Create a summary for the dashboard's default view
summary = (
    raw.group_by(["region", "month"])
    .agg(pl.col("revenue").sum(), pl.col("units").sum())
    .collect()
)
summary.write_parquet("output_folder/app_name/data/sales_summary.parquet")

# Ship both: summary for fast default view, raw for drill-down
```

The app loads the small summary first (instant), and only fetches the full dataset if the user drills down.

## Track 2 Dev Launcher Scripts (REQUIRED)

Every PWA task folder must contain `run_app.sh` and `run_app.bat` alongside `build_app_package.py` and `src/`. These are the **developer's** one-command launchers — they rebuild the package and immediately launch the OS-appropriate launcher inside `output_folder/{app_name}/`. Don't confuse them with the recipient-facing launchers (`pc_start.bat` / `mac_start.command` / `mac_start.sh`) that ship inside the output package.

**`run_app.sh`:**
```bash
#!/bin/bash
# Run: bash app_folder/scripts/{app_name}/run_app.sh
cd "$(dirname "$0")"
APP_NAME="$(basename "$(pwd)")"

echo "[1/2] Building app package..."
python build_app_package.py || exit 1

echo "[2/2] Launching..."
PROJECT_DIR="$(cd ../../.. && pwd)"
OUTPUT_PKG="$PROJECT_DIR/output_folder/$APP_NAME"
bash "$OUTPUT_PKG/mac_start.sh"
```

**`run_app.bat`:**
```batch
@echo off
REM Run: app_folder\scripts\{app_name}\run_app.bat
cd /d "%~dp0"
for %%I in ("%cd%") do set APP_NAME=%%~nxI

echo [1/2] Building app package...
python build_app_package.py
if %ERRORLEVEL% NEQ 0 exit /b %ERRORLEVEL%

echo [2/2] Launching...
cd /d "%~dp0..\..\..\output_folder\%APP_NAME%"
call pc_start.bat
```

`run_app.sh` must be `chmod +x` so it runs without `bash` prefix. The launcher is OS-specific by design — Mac developers use `.sh`, Windows developers use `.bat`. Both rebuild + serve in one step so the developer always sees their latest source changes.

## PWA Constraints and Gotchas

1. **No JSX** — all React code must use `React.createElement`. No transpiler runs on the user's machine.
2. **No ES modules** — use plain `<script>` tags and `window.duckdb`. The `file://` fallback is broken for modules.
3. **No Node.js on user's machine** — Node.js is only needed on the developer's machine during `build_`.
4. **No Python on user's Windows machine** — that's why Windows uses PowerShell for the HTTP server instead of `python3 -m http.server`.
5. **Absolute URLs for WASM/Worker** — always derive from `window.location.href`, never use relative paths.
6. **Dynamic port** — launcher scripts pick an available port at startup (bind to port 0, OS assigns one). Never hardcode a port number.
7. **Single user** — this runs on localhost, no auth, no multi-user. One person at a time.
8. **Parquet only** — DuckDB-WASM reads Parquet natively. For CSV input, convert to Parquet in the build script.
9. **MOTW on Windows** — users must unblock the zip before extracting, or use 7-Zip.
10. **`var` not `const`/`let`** — for maximum browser compatibility in the non-transpiled JS, prefer `var` and traditional function syntax.

---

# Track 3: Full-Stack Apps (React + Python Backend)

**Use this track when the app needs a live backend at runtime** — API calls to external services, RAG/LLM integration, authentication, mutations that persist to a database, or anything else that can't run in a static browser bundle.

When asked to build a dashboard or interactive tool that needs a backend, first ask the user: **React + Python** or **Streamlit**?

## React + Python

- Backend (Flask/FastAPI) and frontend (Vite) each pick an **available port** at startup — never hardcode `5000`/`3000` or any specific port
- The launcher script reserves two free ports up front and passes them to both processes via env vars (`BACKEND_PORT`, `FRONTEND_PORT`); the frontend's Vite proxy reads `BACKEND_PORT` so `/api` calls go to the right place
- Backend CORS allows any `http://localhost:<port>` origin so the dynamic frontend port works
- Use Polars for all backend data processing
- Paginate API endpoints that return data — never return full datasets
- Filter and sort server-side

```
project_folder/
└── app_folder/
    └── scripts/
        └── {app_name}/                 <- Everything for this app lives here
            ├── backend/
            │   ├── app.py              <- Flask/FastAPI backend (port from BACKEND_PORT env)
            │   └── requirements.txt
            ├── frontend/
            │   ├── package.json
            │   └── src/
            ├── setup.sh / setup.bat
            ├── run_app.sh / run_app.bat
            └── clear_cache.sh / clear_cache.bat
```

The `backend/`, `frontend/`, and launcher scripts all live together inside `app_folder/scripts/{app_name}/` — never at the project root. Launcher scripts `cd "%~dp0"` (own folder) so `backend/` and `frontend/` are direct siblings. The backend's `PROJECT_DIR` walks up 5 levels to reach `project_folder/` (`backend/` → `{app_name}/` → `scripts/` → `app_folder/` → `project_folder/`).

### Backend Template (backend/app.py)

```python
from flask import Flask, jsonify, request
from flask_cors import CORS
import polars as pl
import os
import json
import re
import socket

app = Flask(__name__)
# Allow any localhost origin so the frontend can pick a dynamic port
CORS(app, origins=re.compile(r"^http://localhost:\d+$"))

# 5 levels up: backend/ → {app_name}/ → scripts/ → app_folder/ → project_folder/
PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))
INPUT_FOLDER = os.path.join(PROJECT_DIR, "input_folder")
OUTPUT_FOLDER = os.path.join(PROJECT_DIR, "output_folder")

# Simple cache: {cache_key: {"mtime": float, "data": any}}
_cache = {}

def get_cached_or_compute(file_path, compute_fn):
    """Cache results and invalidate when file changes."""
    mtime = os.path.getmtime(file_path)
    cache_key = f"{file_path}:{compute_fn.__name__}"
    if cache_key in _cache and _cache[cache_key]["mtime"] == mtime:
        return _cache[cache_key]["data"]
    result = compute_fn(file_path)
    _cache[cache_key] = {"mtime": mtime, "data": result}
    return result

def find_free_port():
    """Bind to port 0, let the OS pick a free port, then close."""
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port

@app.route("/api/health")
def health():
    return jsonify({"status": "ok"})

# Add your API routes here — always paginated, always server-side filtered

if __name__ == "__main__":
    # Prefer the launcher-provided port; fall back to any free port
    port = int(os.environ.get("BACKEND_PORT") or find_free_port())
    print(f"Backend running on http://localhost:{port}")
    app.run(host="0.0.0.0", port=port, debug=True)
```

### backend/requirements.txt

```
flask
flask-cors
polars
```

### Frontend Setup

Use Vite. The dev server reads its port from `FRONTEND_PORT` and proxies `/api` to whatever port the backend is on (passed in as `BACKEND_PORT`). Both come from the launcher script — never hardcoded.

```js
// vite.config.js
import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    // 0 lets Vite pick a free port if FRONTEND_PORT isn't set
    port: Number(process.env.FRONTEND_PORT) || 0,
    strictPort: false,
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.BACKEND_PORT}`,
        changeOrigin: true,
      },
    },
  },
})
```

If you're using Create React App instead, replace the `package.json` `"proxy"` field with the `http-proxy-middleware` `setupProxy.js` pattern so the target can read `process.env.BACKEND_PORT` at runtime — `package.json`'s static `"proxy"` field can't reference env vars.

### Example: Paginated API Endpoint

```python
@app.route("/api/data")
def get_data():
    page = request.args.get("page", 1, type=int)
    page_size = request.args.get("page_size", 100, type=int)
    sort_by = request.args.get("sort_by", None)
    sort_desc = request.args.get("sort_desc", "false") == "true"
    filters = request.args.get("filters", "{}")

    lf = pl.scan_csv(os.path.join(INPUT_FOLDER, "data.csv"))

    # Apply filters
    import json
    for col, val in json.loads(filters).items():
        lf = lf.filter(pl.col(col) == val)

    # Apply sorting
    if sort_by:
        lf = lf.sort(sort_by, descending=sort_desc)

    # Get total count (for pagination UI)
    total = lf.select(pl.len()).collect().item()

    # Paginate
    offset = (page - 1) * page_size
    rows = lf.slice(offset, page_size).collect()

    return jsonify({
        "rows": rows.to_dicts(),
        "total": total,
        "page": page,
        "page_size": page_size
    })
```

## Streamlit

Place the script in `app_folder/scripts/{app_name}/`. The IDE detects and runs it automatically.

## Track 3 Launcher Scripts (REQUIRED)

Track 3 follows the universal "every task folder has `run_app.sh`/`.bat`" rule, but adds **two more pairs** because of the Node + Python dependency surface. Every Track 3 task folder must contain **6 launcher scripts** in `app_folder/scripts/{app_name}/` (alongside `backend/` and `frontend/`):

- `setup.sh` / `setup.bat` — One-time dependency install (idempotent, skips what's already installed)
- `run_app.sh` / `run_app.bat` — Starts the app (fast, no installs, single terminal)
- `clear_cache.sh` / `clear_cache.bat` — Nukes caches and re-runs setup

### CRITICAL rules for launcher scripts:

1. **Always create ALL 6 scripts** (3 .sh + 3 .bat)
2. **Always include the run command as a comment at the top**
3. **`run_app` must NEVER install dependencies** — it only starts servers
4. **`run_app` must check if deps exist** and tell the user to run setup if missing
5. **`setup` must be idempotent** — check before installing, show progress with step numbers
6. **`clear_cache` must automatically run setup after clearing**
7. **Always use `call` before `npm` commands in .bat files** (without `call`, the .bat exits after npm runs)
8. **Always use `cd /d` in .bat files** (handles drive letter changes on Windows)
9. **Run frontend and backend concurrently in one terminal** using `npx concurrently`

### Windows Setup (setup.bat)

```batch
@echo off
REM Run: app_folder\scripts\{app_name}\setup.bat
REM cd to this script's own folder — backend\ and frontend\ are siblings here
cd /d "%~dp0"

echo ========================================
echo  Project Setup
echo ========================================

echo.
echo [1/3] Checking Python dependencies...
pip show flask >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo       Installing Python dependencies...
    pip install -r backend\requirements.txt
) else (
    echo       Already installed, skipping.
)

echo.
echo [2/3] Checking Node dependencies...
if not exist "frontend\node_modules" (
    echo       Installing Node dependencies...
    cd frontend
    call npm install
    cd ..
) else (
    echo       Already installed, skipping.
)

echo.
echo [3/3] Checking concurrently...
call npx concurrently --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo       Installing concurrently...
    cd frontend
    call npm install concurrently --save-dev
    cd ..
) else (
    echo       Already installed, skipping.
)

echo.
echo ========================================
echo  Setup complete! Run: app_folder\scripts\{app_name}\run_app.bat
echo ========================================
```

### Windows Launcher (run_app.bat)

```batch
@echo off
REM Run: app_folder\scripts\{app_name}\run_app.bat
REM cd to this script's own folder — backend\ and frontend\ are siblings here
cd /d "%~dp0"

REM Check dependencies
if not exist "frontend\node_modules" (
    echo Dependencies not installed. Run setup.bat first.
    echo   app_folder\scripts\{app_name}\setup.bat
    exit /b 1
)

echo ========================================
echo  Launching App
echo ========================================

REM Reserve two free ports up front so frontend + backend agree on what's used.
REM Python binds to port 0, OS assigns a free port, prints it.
for /f %%p in ('python -c "import socket; s=socket.socket(); s.bind((''''127.0.0.1'''',0)); print(s.getsockname()[1]); s.close()"') do set BACKEND_PORT=%%p
for /f %%p in ('python -c "import socket; s=socket.socket(); s.bind((''''127.0.0.1'''',0)); print(s.getsockname()[1]); s.close()"') do set FRONTEND_PORT=%%p

echo Backend  : http://localhost:%BACKEND_PORT%
echo Frontend : http://localhost:%FRONTEND_PORT%
cd frontend
call npx concurrently -n "backend,frontend" -c "blue,green" "cd /d \"%cd%\..\" && python backend\app.py" "npm run dev"
```

### Windows Clear Cache (clear_cache.bat)

```batch
@echo off
REM Run: app_folder\scripts\{app_name}\clear_cache.bat
REM cd to this script's own folder — backend\ and frontend\ are siblings here
cd /d "%~dp0"

echo ========================================
echo  Clearing Cache
echo ========================================

echo Removing node_modules...
if exist "frontend\node_modules" rmdir /s /q "frontend\node_modules"

echo Removing __pycache__...
for /d /r . %%d in (__pycache__) do @if exist "%%d" rmdir /s /q "%%d"

echo Removing build artifacts...
if exist "frontend\build" rmdir /s /q "frontend\build"
if exist "frontend\dist" rmdir /s /q "frontend\dist"

echo.
echo Cache cleared. Running setup...
echo.
call "%~dp0setup.bat"
```

### macOS/Linux Setup (setup.sh)

```bash
#!/bin/bash
# Run: bash app_folder/scripts/{app_name}/setup.sh
# cd to this script's own folder — backend/ and frontend/ are siblings here
cd "$(dirname "$0")"

echo "========================================"
echo " Project Setup"
echo "========================================"

echo ""
echo "[1/3] Checking Python dependencies..."
if pip show flask > /dev/null 2>&1; then
    echo "      Already installed, skipping."
else
    echo "      Installing Python dependencies..."
    pip install -r backend/requirements.txt
fi

echo ""
echo "[2/3] Checking Node dependencies..."
if [ -d "frontend/node_modules" ]; then
    echo "      Already installed, skipping."
else
    echo "      Installing Node dependencies..."
    cd frontend
    npm install
    cd ..
fi

echo ""
echo "[3/3] Checking concurrently..."
if npx concurrently --version > /dev/null 2>&1; then
    echo "      Already installed, skipping."
else
    echo "      Installing concurrently..."
    cd frontend
    npm install concurrently --save-dev
    cd ..
fi

echo ""
echo "========================================"
echo " Setup complete! Run: bash app_folder/scripts/{app_name}/run_app.sh"
echo "========================================"
```

### macOS/Linux Launcher (run_app.sh)

```bash
#!/bin/bash
# Run: bash app_folder/scripts/{app_name}/run_app.sh
# cd to this script's own folder — backend/ and frontend/ are siblings here
cd "$(dirname "$0")"

# Check dependencies
if [ ! -d "frontend/node_modules" ]; then
    echo "Dependencies not installed. Run setup.sh first."
    echo "  bash app_folder/scripts/{app_name}/setup.sh"
    exit 1
fi

echo "========================================"
echo " Launching App"
echo "========================================"

# Reserve two free ports up front so frontend + backend agree on what's used.
# Python binds to port 0, OS assigns a free port, prints it.
export BACKEND_PORT=$(python3 -c "import socket; s=socket.socket(); s.bind(('127.0.0.1',0)); print(s.getsockname()[1]); s.close()")
export FRONTEND_PORT=$(python3 -c "import socket; s=socket.socket(); s.bind(('127.0.0.1',0)); print(s.getsockname()[1]); s.close()")

echo "Backend  : http://localhost:$BACKEND_PORT"
echo "Frontend : http://localhost:$FRONTEND_PORT"
cd frontend
npx concurrently -n "backend,frontend" -c "blue,green" \
    "cd .. && python backend/app.py" \
    "npm run dev"
```

### macOS/Linux Clear Cache (clear_cache.sh)

```bash
#!/bin/bash
# Run: bash app_folder/scripts/{app_name}/clear_cache.sh
# cd to this script's own folder — backend/ and frontend/ are siblings here
cd "$(dirname "$0")"

echo "========================================"
echo " Clearing Cache"
echo "========================================"

echo "Removing node_modules..."
rm -rf frontend/node_modules

echo "Removing __pycache__..."
find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null

echo "Removing build artifacts..."
rm -rf frontend/build frontend/dist

echo ""
echo "Cache cleared. Running setup..."
echo ""
bash "$(dirname "$0")/setup.sh"
```

### Non-React Apps (Simple Python Scripts or Streamlit)

For simple scripts without a frontend, only `run_app` scripts are needed (no setup/clear_cache). They live alongside the script inside `app_folder/scripts/{app_name}/`:

**run_app.bat:**
```batch
@echo off
REM Run: app_folder\scripts\{app_name}\run_app.bat
REM cd to this script's own folder — your_script.py is a sibling
cd /d "%~dp0"
python your_script.py
```

**run_app.sh:**
```bash
#!/bin/bash
# Run: bash app_folder/scripts/{app_name}/run_app.sh
# cd to this script's own folder — your_script.py is a sibling
cd "$(dirname "$0")"
python your_script.py
```
