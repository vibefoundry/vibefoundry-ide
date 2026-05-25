# Project Context

You are working in the project root with full access to all project files including input data, output results, and scripts.

## When to Plan vs. Just Do It

**Only present a plan when building something multi-step** (a new app, a dashboard, a pipeline). Keep plans short (3-7 steps), wait for approval, then execute one step at a time.

**For quick requests — analysis questions, graphs, single scripts — skip the plan and just do it.** Write the script, run it, save the output. Don't ask for permission on simple tasks.

**Never re-present or update the plan when the user asks a follow-up question.** A follow-up is a new task — just execute it directly. The plan was for the original build, not every subsequent request.

## Task Continuity Within a Session

**By default, assume every request during a session is part of the same task the user is already working on.** New scripts and outputs should go into the current task's folder (e.g., keep adding steps to `app_folder/scripts/regional_analysis/` and writing outputs to `output_folder/regional_analysis/`) rather than creating a new task folder for each message.

**When it's unclear whether the request continues the current task or starts a new one, ask before creating a new task folder.** Signals that it might be a new task: the request involves a different dataset, a different goal, or has no logical connection to what was just built. When in doubt, ask: *"Is this a continuation of the {current task name} task, or should I create a new task folder for it?"* — then proceed based on the answer.

## Which Track? — Pick One Before You Start

Every project falls into one of four tracks. **Pick the track before writing any code**, then follow that track's dedicated section below. The rules *above* this section (planning, task continuity, folder structure, "input is sacred") apply to all four tracks.

| Track | When to use | What it produces |
|---|---|---|
| **1. Python Scripts** | Data processing, analysis, cleaning, aggregation, visualization — anything that reads input, transforms it, writes output | `.parquet` / `.png` files in `output_folder/{task}/` |
| **2. Progressive Web App** (DuckDB-WASM + React) | Interactive dashboards or explorers over large static data, distributable as a zip-and-share folder that runs entirely in the user's browser | A self-contained folder in `output_folder/{app_name}/` with launcher scripts |
| **3. PWA + Python Runtime** (React + Python backend) | Apps that need a live server at runtime — API calls, RAG/LLM, auth, mutations, external services, secrets. Same React UI pattern as Track 2 PWAs, plus a local Python backend. | A running dev server pair (frontend + backend) with launcher scripts |
| **4. Building Agents** (LLM-in-the-loop) | Per-record processing through an LLM — extraction, classification, vision, code generation, summarization — with prompts, retries, and structured output | Structured records / ledgers + per-record archives in `output_folder/{app_name}/` |

### How to pick

- **Processes records through an LLM** — extraction, classification, vision, code generation, narration — one record at a time, with prompts and retries? → **Track 4** (check this first; an agent also has "no interaction beyond running it," so it would otherwise fall through to Track 1)
- **No user interaction beyond running the script?** → **Track 1**
- **Interactive UI, but all logic can run against static Parquet files in the browser?** → **Track 2**
- **Needs a server to exist at runtime** (external APIs, secrets, RAG, mutations, auth)? → **Track 3**

When the user's request is ambiguous (e.g., "build me a dashboard"), ask: *"Is this a static dashboard over existing Parquet data (PWA), or does it need a Python runtime for live data / API calls (PWA + Python Runtime)?"* — then proceed based on the answer.

Once the track is chosen, only the sections for that track apply. Don't mix patterns across tracks (e.g., don't use Track 1's `app.py` + step naming for Track 3's backend, and don't create Track 3 launcher scripts for a Track 1 task).

## File Naming by Track — Numbered Steps Are For Linear Pipelines Only

The `step1_*.py` / `step2_*.py` / `step3_*.py` naming convention is **reserved for Track 1 data-processing pipelines**, where the number encodes a fixed file-to-file handoff (step2 reads the parquet step1 wrote, in that order). Anywhere else the number lies — there's no ordered handoff to encode.

**Every other track names its `.py` files by role, not by number.** For Track 4 agents and any other non-linear processing, each distinct task gets its own `.py` file named for what it does (e.g. `prompt.py`, `retry.py`, `parse.py`, `export.py`) and `app.py` composes them by calling their functions. Do not number these files — numbering asserts an ordering the structure doesn't implement, and makes the role of each file harder to read at a glance. One task per file; the filename tells you what the task is.

| Track | File naming inside `app_folder/scripts/{app_name}/` |
|---|---|
| 1. Python Scripts (linear pipeline) | `app.py` + `step1_*.py`, `step2_*.py`, … — numbered, because each step reads the previous step's output file |
| 2. PWA | No per-task `.py` files in the app source — JS/HTML/CSS, plus the `app.py` build script and dev helpers under `app_core/` |
| 3. PWA + Python Runtime | Backend preserves the source pipeline/agent's `.py` filenames — see "Preserve original .py filenames" inside the Track 3 section |
| 4. Building Agents | Role-named: `app.py` + `prompt.py`, `retry.py`, `parse.py`, `export.py`, … — never `step1_*.py` |

## Folder Structure

```
project_folder/           <- You are here
├── AGENTS.md             <- This file (agent instructions — Claude Code, Codex, etc.)
├── input_folder/         <- Source data files
├── output_folder/        <- Scripts save results here
└── app_folder/
    ├── meta_data/        <- Metadata describing available data
    └── scripts/          <- Every app lives here (one folder per app)
```

### Everything goes under `app_folder/scripts/`

**ALL applications live in `app_folder/scripts/{app_name}/` — no exceptions.** This is the single source of truth for code, regardless of which track the app falls under:

- **Track 1 — Python scripts:** `app_folder/scripts/{task_name}/` contains `app.py` + `step1_*.py`, `step2_*.py`, etc.
- **Track 2 — PWA (DuckDB-WASM + React):** `app_folder/scripts/{app_name}/` contains the build script (`app.py`) **and** the PWA source files (`index.html`, `css/`, `js/`).
- **Track 3 — PWA + Python Runtime (React + Python backend):** `app_folder/scripts/{app_name}/` contains `backend/`, `frontend/`, and the launcher scripts (`setup.sh`/`run_app.sh`/`clear_cache.sh` + `.bat` equivalents).

**Never put app code at the top of `app_folder/`, at the project root, or anywhere outside `app_folder/scripts/`.** If you find yourself creating `app_folder/{app_name}/` or top-level `backend/` and `frontend/` folders, stop — move them under `app_folder/scripts/{app_name}/` instead. The only top-level folders allowed inside `app_folder/` are `scripts/` and `meta_data/`.

### Every task folder MUST contain `run_app.sh` and `run_app.bat`

Every single `app_folder/scripts/{app_name}/` folder — regardless of track — must contain **both** `run_app.sh` (Mac/Linux) and `run_app.bat` (Windows). These are the canonical, one-command entry points the developer uses to run the app locally. **No exceptions.**

What `run_app` does varies by track:

| Track | What `run_app.sh` / `run_app.bat` does |
|---|---|
| **Track 1 — Python pipeline** | `cd` into the task folder and `python app.py` (the orchestrator that runs `step1_*.py`, `step2_*.py`, …) |
| **Track 2 — PWA** | Runs `python build_app_package.py` to rebuild the output package, then launches the corresponding OS launcher inside `output_folder/{app_name}/` (`mac_start.sh` or `pc_start.bat`) so the developer sees the freshly built app immediately |
| **Track 3 — PWA + Python Runtime** | Reserves two free ports, then runs the backend and frontend concurrently (see Track 3 launcher template below). Track 3 also gets `setup.sh`/`.bat` and `clear_cache.sh`/`.bat` for dependency management. |

Both `.sh` files must be `chmod +x` by the build/setup process so they're executable. The `.bat` and `.sh` files always live alongside each other inside the task folder.

## Input Data Is Sacred — Never Edit It

**Never modify, overwrite, or delete any file in `input_folder/`.** This folder is read-only. Users drop their source data here and trust that it will never be touched.

All transformations, merges, cleaning, filtering, deduplication, reformatting, and any other processing must produce **new files in `output_folder/`** — never edit the originals. If a script needs "cleaned" data, it reads from `input_folder/`, cleans it, and writes the result to `output_folder/`. The input stays pristine.

This is a hard rule with no exceptions. Even if the user says "fix the data" or "clean the CSV," that means: read the input, transform it, and save the result as output. Never write back to `input_folder/`.

## API Keys Live in a `.env` File at the Top of the App Folder

Every app that needs an API key keeps a single `.env` file at the **top of its own folder** — `app_folder/scripts/{app_name}/.env`, the same directory as `run_app.sh` (and as `backend/`/`frontend/` for a PWA + Python Runtime app). **Not** `app_folder/.env`, **not** the project root, **not** `input_folder/`. Keeping the key beside the launchers makes the whole app folder self-contained: move or zip it and the key travels with it.

**Convention:**

- **Location:** `app_folder/scripts/{app_name}/.env` — the app folder root, alongside `run_app.sh`/`run_app.bat`.
- **Format:** standard `KEY=VALUE` lines, one per provider. No quotes needed.

  ```
  OPENAI_API_KEY=sk-...
  ANTHROPIC_API_KEY=sk-ant-...
  ```

- **Reading:** load the `.env` into the process environment once at startup so SDKs (OpenAI, Anthropic, etc.) pick the key up automatically. A tiny hand-rolled loader avoids a `python-dotenv` dependency:

  ```python
  import os
  from pathlib import Path

  # App folder root = same dir as run_app.sh. Adjust the depth if this file is
  # nested (e.g. a Track 3 backend/ module: use Path(__file__).resolve().parent.parent).
  APP_DIR = Path(__file__).resolve().parent
  env_path = APP_DIR / ".env"
  if env_path.exists():
      for line in env_path.read_text(encoding="utf-8").splitlines():
          line = line.strip()
          if line and not line.startswith("#") and "=" in line:
              k, _, v = line.partition("=")
              os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

  if not os.environ.get("OPENAI_API_KEY"):
      raise RuntimeError(
          "Missing OPENAI_API_KEY. Create a .env at the top of this app folder "
          "(next to run_app.sh) containing: OPENAI_API_KEY=sk-..."
      )
  ```

  The cloned templates already ship this loader as `prompt.py`'s `_load_dotenv()` — reuse it, don't re-invent it.

**The VibeFoundry IDE shows `.env` files.** Although `.env` is normally a hidden dotfile, the IDE's file explorer surfaces it so the user can create and edit it in-app, no terminal needed. Point the user at the app folder and have them paste the key there.

**Asking the user for the key:** if an app needs a key and the `.env` isn't there (or the variable is missing), stop and ask: *"This app needs an API key — create a `.env` file at the top of the app folder (next to `run_app.sh`) containing `OPENAI_API_KEY=sk-...`, then tell me to continue."* Never paste the key into a chat, into a tracked file, or onto a command line. The user adds it to `.env` themselves.

**Don't commit the key to git** — ensure `.env` (and `**/.env` for the nested app folders) is in `.gitignore` before the initial commit.

## `templates/` Is Read-Only — Never Edit It

**Never modify, create, rename, or delete anything inside `templates/`.** The folder is a reference library cascaded into the project by Build — it is not project source. Treat it like vendored third-party code: you read from it, you copy *out* of it, but you never write *into* it.

If you need to start a new app from a template, **fork it**: copy the relevant subfolder out of `templates/` into `app_folder/scripts/{your_app_name}/` and edit there. Never edit `templates/{template}/` in place, even for "small fixes" or "to try something." If the template itself needs changing, that's a change to the upstream template repo, not to this project.

The IDE keeps `templates/` collapsed in the file tree by design — open it only to look, never to type. Anything that lands inside that folder during a session is reference material, not work product.

## Stay In Scope — Do What Was Asked, Nothing Else

**Don't add features the user didn't ask for. Don't make aesthetic changes the user didn't ask for. Don't make "defensive" fixes the user didn't ask for.** If the request was "build me a PWA for FY26 data," the deliverable is a PWA fit to FY26 data — not a PWA *plus* a redesigned table, *plus* a CSV export button, *plus* a tweak to how nulls render in numeric columns, *plus* a refactor of the build script.

Things you should not do unprompted:

- **No aesthetic edits** — CSS, layout, colors, typography, spacing. The template already looks fine.
- **No feature additions** — extra columns, summary widgets, charts, export buttons, search bars, empty-state messages.
- **No defensive cleanup** — null guards, error boundaries, retry logic, "just in case" branches around code that already works.
- **No refactors** — renaming variables, restructuring functions, extracting helpers, "improving" code you weren't asked to change.

If you notice something you think could be better, ignore the thought. The user will ask if they want it. The biggest single source of agent-driven slowness is editing files outside the actual ask. Ship the smaller change.

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
# All step outputs are parquet. See "Polars Rules" below for the lazy +
# streaming + column-pruned defaults this template follows.
df = (
    pl.scan_csv(os.path.join(INPUT_FOLDER, "sales.csv"))
      .select(["customer_id", "revenue"])  # column-prune early
      .group_by("customer_id")
      .agg(pl.col("revenue").sum().alias("total_revenue"))
      .sort("total_revenue", descending=True)
      .head(10)
      .collect(engine="streaming")
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

The default mode of operation is **lazy + streaming + column-pruned**. This is
not stylistic — it's a 5× RAM and 8× speed difference on a single join+groupby
(measured on a 2-file ~1 GB workload: 3.9 GB → 0.8 GB peak, 2.2 s → 0.3 s).
Treat eager mode as the exception, not the default.

### The five rules — apply in order

1. **Read with `pl.scan_*`, never `pl.read_*`.**
   `pl.scan_csv()` / `pl.scan_parquet()` build a query plan; `pl.read_*` loads
   the whole file into RAM immediately. The only exception is files small enough
   that you'd happily print them (lookup tables, tiny configs).

2. **Column-prune immediately after every `scan_*`.**
   `.select([only, columns, you, need])` is the cheapest RAM win available —
   typically shrinks the dataset 3–10×. Especially before joins: a join's hash
   table is sized by the right-hand columns it carries through.

3. **Filter early, before joins and group-bys.**
   `.filter(...)` chained on the lazy frame pushes the predicate down to the
   parquet reader so unmatched rows never enter RAM. Filtering after the join
   wastes the join's work.

4. **Call `.collect(engine="streaming")` — not bare `.collect()`.**
   The streaming engine processes joins and group-bys in chunks instead of
   materializing the full intermediate. This is the single biggest RAM lever.
   Bare `.collect()` is fine only when the final result is the only large object.

5. **For multi-file workloads, prefer `pl.scan_parquet([list_of_paths])` over
   `pl.concat([scan(...) for ...])`.** Polars treats a list of paths as one
   logical dataset and can stream across files. If you must concat, do it lazily
   and let streaming handle the rest.

### What "efficient" looks like in practice

```python
outlets = (
    pl.scan_parquet("Outlet Attributes.parquet")
      .select(["OutletCode", "State"])  # rule 2
)

result = (
    pl.scan_parquet([
        "step1_aggregate_annual_FY25.parquet",
        "step1_aggregate_annual_FY26.parquet",
    ])  # rule 5
    .filter(pl.col("Item_SellingVolumeLitres") > 0)  # rule 3
    .join(outlets, on="OutletCode", how="left")
    .group_by(["State", "PUConsumerBrandName"])
    .agg(pl.col("Item_SellingVolumeLitres").sum().alias("vol"))
    .sort("vol", descending=True)
    .head(50)
    .collect(engine="streaming")  # rule 4
)
```

### What to avoid

- `pl.read_parquet(big_file)` followed by transformations — loads everything,
  defeats the optimizer.
- Bare `.collect()` when the pipeline contains a join, group-by, sort, or pivot
  on data larger than ~500 MB.
- Calling `.collect()` mid-pipeline to inspect intermediate shape. Use
  `.head(10).collect()` or `.collect_schema()` instead — neither materializes
  the full frame.
- `pandas` for anything except libraries that demand it. `pandas` is eager by
  design and roughly 2× the RAM of equivalent Polars.

### When eager mode is acceptable

- The final step output is small (e.g., a top-N or a summary the next step
  reads). The output of `.collect()` is a real `DataFrame` — that's expected.
- The input file is genuinely tiny (< 50 MB on disk, < 200 MB in RAM).
- Writing parquet: `df.write_parquet(...)` after a final collect is correct.

### RAM budget — what fits where

| Machine RAM | Comfortable working-set with streaming | Without streaming |
|---|---|---|
| 8 GB        | ~1.5 GB DataFrames in flight           | ~500 MB DataFrames |
| 16 GB       | ~6 GB DataFrames in flight             | ~2 GB DataFrames   |
| 32 GB       | ~16 GB DataFrames in flight            | ~6 GB DataFrames   |

If a script's working-set exceeds the "without streaming" column, **streaming is
mandatory, not optional**.

- Only fall back to Pandas if a specific library requires it.

## Track 1 Launcher Scripts (REQUIRED)

Every Track 1 task folder must contain `run_app.sh` and `run_app.bat` alongside `app.py` and the step files. Both just `cd` into the task folder and run the orchestrator:

**`run_app.sh`:**
```bash
#!/bin/bash
# Run: bash app_folder/scripts/{task_name}/run_app.sh
cd "$(dirname "$0")"
python app.py
```

**`run_app.bat`:**
```batch
@echo off
REM Run: app_folder\scripts\{task_name}\run_app.bat
cd /d "%~dp0"
python app.py
```

That's it for Track 1 — no `setup.sh`/`clear_cache.sh` needed since there are no Node deps. Both files must be `chmod +x` on Mac/Linux.

---

# Track 2: Progressive Web Apps (DuckDB-WASM + React)

**Use this track when the user wants:** an interactive dashboard or data explorer that ships as a zip-and-share folder and runs entirely in the user's browser. No Python or Node.js on the user's machine — just a browser and a tiny local HTTP server that serves static files.

These apps are distributed as folders users launch with a `.bat` (Windows) or `.command` (Mac) file. No IT involvement required on the user's machine.

## ⚠️ Read `templates/pwa_duckdb/CUSTOMIZE.md` first — that's your recipe.

**Don't build a Track 2 PWA from scratch.** A complete, working DuckDB-WASM + React PWA template is already cascaded into your project at `templates/pwa_duckdb/`. Your job for any Track 2 task is to *clone it* into `app_folder/scripts/{task_name}/`, swap in the user's data, rewrite `app_config.json`, and stop. The full step-by-step lives in `templates/pwa_duckdb/CUSTOMIZE.md` — read that file before doing anything else. It tells you exactly which files to edit, which not to touch, and which inspection queries to run.

The rest of this Track 2 section (architecture overview, build script template, JS patterns, launcher details) is *reference material* — read it only if `CUSTOMIZE.md` doesn't answer a specific question. **Do not use the build-from-scratch instructions below to recreate what the template already provides.** Skipping the recipe and rewriting the template files (the build script, the launchers, `app.js`, `js/app.js`'s rendering logic) is the single biggest cause of Track 2 tasks blowing past their time budget.

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
    └── {app_name}/                          <- Everything for this app lives here
        ├── build_app_package.py             <- Build script (assembles the distributable)
        ├── run_app.sh                       <- Dev launcher (Mac/Linux)
        ├── run_app.bat                      <- Dev launcher (Windows)
        └── app_core/
            ├── prepare_dev_assets.py        <- Stages parquets from input_folder/ into src_app/data/
            ├── serve.py                     <- Local dev HTTP server (Python stdlib, picks free port)
            ├── sample_data/                 <- Fallback parquets — used only when input_folder/ is empty
            └── src_app/                     <- The PWA source — exactly what ships to the recipient
                ├── index.html
                ├── css/styles.css
                ├── js/app.js                <- React app (plain JS, no JSX)
                ├── lib/                     <- Pre-bundled browser libs, committed to the template
                │   ├── react.min.js
                │   ├── react-dom.min.js
                │   ├── duckdb-bundle.js
                │   ├── duckdb-eh.wasm
                │   └── duckdb-browser-eh.worker.js
                └── data/
                    ├── app_config.json      <- App metadata + dataset schemas (see below)
                    └── *.parquet            <- Staged from input_folder/ at build/dev time
```

The build script is **always named `build_app_package.py`** and lives at the task folder's top level alongside `run_app.sh`/`run_app.bat`. Everything else — the dev tooling (`prepare_dev_assets.py`, `serve.py`), the optional sample fallback, and the actual web app source — is grouped under `app_core/`. The `src_app/` subfolder is the only thing that gets shipped: `build_app_package.py` does a `shutil.copytree(src_app, application_files)` and stops.

**Pre-bundled `lib/` — no Node.js, ever.** The React UMD bundles, the DuckDB-WASM browser bundle (`duckdb-bundle.js`), the worker, and the `.wasm` itself are all committed in `src_app/lib/`. The build script does not run npm, esbuild, or fetch from unpkg — it just copies. This makes the whole pipeline pure-Python on the developer's machine, and the recipient never touches Node at all.

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
        │   ├── duckdb-bundle.js            <- DuckDB-WASM browser bundle (committed, no esbuild)
        │   ├── duckdb-eh.wasm              <- DuckDB WASM binary (~33 MB)
        │   └── duckdb-browser-eh.worker.js <- DuckDB Web Worker
        ├── data/
        │   ├── app_config.json             <- App metadata + dataset schemas
        │   └── *.parquet                   <- Data files from input_folder/
        └── serve.ps1                       <- PowerShell HTTP server (called by pc_start.bat)
```

**Top-level rule:** the package's top level contains exactly `pc_start.bat`, `mac_start.command`, `mac_start.sh`, and `application_files/`. **Nothing else.** All assets, data, and helper scripts live inside `application_files/`. Every launcher file `cd`s into `application_files/` before doing anything.

**Why ship both `mac_start.command` and `mac_start.sh`?** They contain the same bash logic — only the extension differs:
- **`.command`** is the double-click path. Finder opens it in Terminal automatically. Recipients hit a Gatekeeper "macOS cannot verify the developer" prompt on first launch — they right-click → Open the first time, double-click thereafter.
- **`.sh`** is the Terminal-only path. Power users (or anyone who hits a stuck Gatekeeper block on Sequoia) can run `bash mac_start.sh` from Terminal and skip the prompt entirely.

The build script must `chmod +x` both Mac files so they're executable.

## Build Script Template

The build script (`app_folder/scripts/{app_name}/build_app_package.py`) runs on the **developer's machine** with nothing but Python — no Node.js, no npm, no esbuild. It assembles the distributable at `output_folder/{app_name}/` (rmtree-and-recreate; never assume it already exists).

### What the build script does (2 steps):

1. **Stage parquet data** — call `prepare_dev_assets()` from `app_core/prepare_dev_assets.py`. This walks `app_config.json`'s `datasets[].file` list and copies each parquet from `input_folder/` into `src_app/data/`. If a file is missing from `input_folder/` but already exists in `src_app/data/`, it's left alone (idempotent re-runs). If neither has it, `sample_data/` is used as a last-resort fallback for template demos — real apps should never hit this branch.
2. **Assemble the package** — `shutil.copytree(src_app/, application_files/)`, then write the four launcher files at the package top level (`pc_start.bat`, `mac_start.command`, `mac_start.sh`, plus `serve.ps1` *inside* `application_files/`). `os.chmod(..., 0o755)` both Mac launchers.

That's the whole build. The pre-bundled `lib/` (React UMD, `duckdb-bundle.js`, `.wasm`, worker) rides along inside `src_app/` and gets copied untouched. There is no esbuild step, no React download from unpkg, and no `manifest.json` to write — `app_config.json` already lives in `src_app/data/` and gets copied with everything else.

### app_config.json format:

`app_config.json` is the single source of truth for the app's metadata: title, dataset list, and per-column display + filter rules. The dev launcher reads it to know which parquets to stage; the React app reads the same file at runtime to render the UI. Schema:

```json
{
  "app_title": "Data Viewer",
  "datasets": [
    {
      "id": "customers",
      "label": "Customers",
      "file": "customers.parquet",
      "columns": [
        { "name": "customer_id",     "label": "ID" },
        { "name": "name",            "label": "Name",           "filter": "text" },
        { "name": "region",          "label": "Region",         "filter": "select" },
        { "name": "is_active",       "label": "Active",         "filter": "boolean" },
        { "name": "lifetime_value",  "label": "Lifetime Value", "filter": "range" }
      ]
    }
  ]
}
```

| Field | Purpose |
|---|---|
| `app_title` | Browser tab title and header |
| `datasets[].id` | Stable identifier — used in URL state, internal lookups |
| `datasets[].label` | Human-readable name in the dataset picker |
| `datasets[].file` | Parquet filename inside `data/` |
| `columns[].name` | Actual column name in the parquet |
| `columns[].label` | Display name in the table header and filter UI |
| `columns[].filter` | Filter widget — one of `text`, `select`, `boolean`, `range`. Omit for display-only columns. |

A column without a `filter` field is still shown in the table but has no filter widget. Adding a column to a dataset is a config-only change — no JS edit required.

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
    var resp = await fetch("data/app_config.json");
    var config = await resp.json();
    var datasets = config.datasets;

    for (var i = 0; i < datasets.length; i++) {
        var ds = datasets[i];
        var dataResp = await fetch("data/" + ds.file);
        var buffer = new Uint8Array(await dataResp.arrayBuffer());
        await db.registerFileBuffer(ds.file, buffer);
    }

    return datasets;
}
```

Each Parquet file is fetched, loaded into a `Uint8Array`, and registered with DuckDB. After registration, you can query it with SQL: `SELECT * FROM read_parquet('filename.parquet')`. Use `ds.file` for the registered name and the `read_parquet()` argument so they match.

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

### Geospatial defaults

For map-based apps, default to:

- **Leaflet over deck.gl.** Use deck.gl only when the user explicitly asks for it, or when the dataset is large enough (100K+ rendered points) that Leaflet drops frames. Leaflet covers choropleth, markers, polygons, and heatmaps cleanly for nearly every business case and keeps the bundle lighter.
- **OpenStreetMap as the basemap.** Free, no API key, decent global coverage. Tile URL: `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`. Always include the attribution string `'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'` on the tile layer.
- **TIGER (US Census boundaries / street data) — only fetch when the user explicitly requests it.** Source: <https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html>. TIGER ships as Shapefiles; convert them to Parquet with a geometry column (via DuckDB's spatial extension or GeoPandas) before shipping inside the app's `data/` folder — the browser should never have to parse Shapefile bytes.

Everything else — choropleth thresholds, marker clustering rules, custom layer interactions, projection handling — is up to you given the user's specific ask. Don't over-engineer the map until the user tells you what they actually want to see.

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
# In build_app_package.py (or a helper called from it) — runs on developer's
# machine with full Polars. Write summaries into src_app/data/ so they get
# copied with everything else when the package is assembled.
import polars as pl

raw = pl.scan_parquet("input_folder/sales.parquet")

# Create a summary for the dashboard's default view
summary = (
    raw.group_by(["region", "month"])
    .agg(pl.col("revenue").sum(), pl.col("units").sum())
    .collect(engine="streaming")
)
summary.write_parquet("app_folder/scripts/{app_name}/app_core/src_app/data/sales_summary.parquet")

# Add the summary to app_config.json's datasets array so the app knows
# about it. Ship both: summary for the fast default view, raw for drill-down.
```

The app loads the small summary first (instant), and only fetches the full dataset if the user drills down.

## Track 2 Dev Launcher Scripts (REQUIRED)

Every PWA task folder must contain `run_app.sh` and `run_app.bat` alongside `build_app_package.py` and `app_core/`. These are the **developer's** one-command "edit and reload" launchers — they stage parquet data and serve `src_app/` directly via `app_core/serve.py` so source edits are visible on browser refresh, without ever touching `output_folder/`.

This is intentionally **not** a build-and-launch flow. To dogfood the actual distributable (verify the launcher trio works, the .ps1 server serves the right MIMEs, etc.), run `python build_app_package.py` once and then run the output's `mac_start.sh` or `pc_start.bat` directly. Build-time only matters when you're about to ship.

**`run_app.sh`:**
```bash
#!/bin/bash
set -e

cd "$(dirname "$0")"

python3 app_core/prepare_dev_assets.py
python3 app_core/serve.py
```

**`run_app.bat`:**
```batch
@echo off
cd /d "%~dp0"

python app_core\prepare_dev_assets.py
if %ERRORLEVEL% NEQ 0 exit /b %ERRORLEVEL%
python app_core\serve.py
```

`run_app.sh` must be `chmod +x` so it runs without `bash` prefix. `prepare_dev_assets.py` syncs the parquets listed in `app_config.json` from `input_folder/` into `src_app/data/`. `serve.py` then picks a free port, registers `.wasm`/`.parquet` MIME types, opens the browser, and serves `src_app/` until Ctrl+C. Edit `js/app.js` or `app_config.json`, hit reload, see the change — no rebuild step in the loop.

## PWA Constraints and Gotchas

1. **No JSX** — all React code must use `React.createElement`. No transpiler runs on the user's machine.
2. **No ES modules** — use plain `<script>` tags and `window.duckdb`. The `file://` fallback is broken for modules.
3. **No Node.js anywhere — not even on the developer's machine.** The browser libs in `src_app/lib/` (React UMD, the DuckDB-WASM bundle, the worker, and the `.wasm` itself) are pre-bundled and committed to the template. The build script just copies; it never runs npm or esbuild.
4. **No Python on user's Windows machine** — that's why Windows uses PowerShell for the HTTP server instead of `python3 -m http.server`.
5. **Absolute URLs for WASM/Worker** — always derive from `window.location.href`, never use relative paths.
6. **Dynamic port** — launcher scripts pick an available port at startup (bind to port 0, OS assigns one). Never hardcode a port number.
7. **Single user** — this runs on localhost, no auth, no multi-user. One person at a time.
8. **Parquet only** — DuckDB-WASM reads Parquet natively. For CSV input, convert to Parquet in the build script.
9. **MOTW on Windows** — users must unblock the zip before extracting, or use 7-Zip.
10. **`var` not `const`/`let`** — for maximum browser compatibility in the non-transpiled JS, prefer `var` and traditional function syntax.

---

# Track 3: PWA + Python Runtime

**This is Track 2's PWA frontend + a local Python backend.** The React UI is the same PWA pattern as Track 2; the difference is that instead of querying static Parquet files in the browser, the frontend calls a Flask/FastAPI backend that can do anything Python can — external API calls, RAG/LLM integration, authentication, mutations, secrets, agentic processing.

**Use this track when** the work can't run in a static browser bundle — anything requiring a live Python runtime at request time.

**Distribution differs from Track 2.** Track 2 ships as zip-and-share with no Python on the recipient's machine. Track 3 requires Python installed locally (it's a developer/internal-tool distribution model, not zip-and-share).

## Preserve original .py filenames in the backend

When a Track 1 pipeline or a Track 4 agent moves behind a React UI here, the backend folder contains the **original `.py` files with their original names**. Don't rename them just because they're now sitting behind a Flask/FastAPI route — the filenames are how the user reads what the app actually does.

- A Track 1 pipeline at `app_folder/scripts/sales_pipeline/{app.py, step1_clean_data.py, step2_merge.py, step3_analyze.py, step4_visualize.py}` becomes `app_folder/scripts/sales_app/backend/{app.py, step1_clean_data.py, step2_merge.py, step3_analyze.py, step4_visualize.py}`. The Flask routes import and call into the same step files.
- A Track 4 agent at `app_folder/scripts/image_scanner/{app.py, prompt.py, retry.py, parse.py, export.py, instructions.json, output_schema.json}` becomes `app_folder/scripts/receipts_app/backend/{app.py, prompt.py, retry.py, parse.py, export.py, instructions.json, output_schema.json}`. The routes call into the same role-named modules.

Add new files for HTTP-layer concerns (e.g. `routes.py`, `api.py`) — but never rename or collapse what's already there. Moving a pipeline or agent behind an HTTP layer doesn't change what each file's job is, so the filenames shouldn't change either.

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

---

# Building Agents

**Use this track when the app is an agent** — an LLM-in-the-loop processor that handles records one at a time (a receipt, a document, an image, a row), builds a prompt, calls a model, validates and retries, and writes a structured result. This is the **fourth track**, alongside Python Scripts, PWA, and PWA + Python Runtime.

An agent is **not** a Track 1 pipeline. Track 1 work is a linear `input → transform → transform → output` chain where order is fixed and each step hands a file to the next. An agent's work is a **set of named stages an orchestrator composes per record** — build a prompt, send it, retry, parse, export. Stages loop and branch; they don't march in a line.

The canonical example is `image_scanner` — a receipt scanner that watches an inbox, sends each image to the OpenAI vision API, and writes a classification ledger plus a per-receipt archive folder.

## ⚠️ Clone the template — don't build from scratch

Like a Track 2 PWA, an agent is **cloned from a template, not written fresh.** The template lives at `templates/agentic_framework/`. For any Building Agents task: copy `templates/agentic_framework/` into `app_folder/scripts/{app_name}/`, then modify the modules and config to fit the user's prompt. Don't reinvent the orchestrator, the retry loop, or the prompt-loading machinery — the template already has them. (`templates/` is read-only — fork out of it, never edit it in place. See "`templates/` Is Read-Only".)

## How to pick this track

- **Reads input, transforms it, writes output, no model call?** → Track 1.
- **Processes records through an LLM** — extraction, classification, vision, code generation, summarization — one record at a time, with prompts, retries, and structured output? → **Building Agents.**

## Folder structure — role-named modules, not numbered steps

Every agent lives in `app_folder/scripts/{app_name}/` like any other app. The module set:

| File | Role |
|---|---|
| `app.py` | **Orchestrator.** Composes the named stages for each record. Owns intake (inbox watcher, queue, or one-shot run) and concurrency. Like Track 1's `app.py`, it orchestrates — but it calls **functions in role-named modules**, not numbered step scripts. |
| `prompt.py` | Builds the instruction text and calls the model — build prompt, send, receive. |
| `retry.py` | Wraps the model call; re-asks on a failed or invalid result, up to a per-template cap. |
| `parse.py` | Turns the model's structured reply into output rows / a ledger. |
| `export.py` | Writes the per-record deliverable (archive folder, JSON, a copy of the source). |
| `instructions.json` | Prompt templates — system text, field rules, model, `max_retries`. |
| `output_schema.json` | The JSON schema the model's reply must match (strict mode). |

### Why named modules, not numbered steps

Track 1 numbers its files (`step1_*.py`, `step2_*.py`) because the number is a **contract**: `step2` reads the `.parquet` file `step1` wrote. The number encodes a file-to-file dependency in a fixed order.

Agent modules make no such promise. They are **roles, not slots**:

- **One module spans several conceptual steps** — `prompt.py` builds, sends, *and* receives.
- **Stages loop, they don't proceed** — `retry.py` wraps and re-invokes the model call; it isn't a step "after" it.
- **No on-disk handoff** — modules pass Python objects via function calls orchestrated by `app.py`, not `.parquet` files between numbered scripts.

So agent files are named by **what they do** (`prompt.py`, `retry.py`, `parse.py`, `export.py`). Numbering them would assert an ordering the structure doesn't implement. If a conceptual step order is worth recording, put it in the module docstrings — not the filenames.

## Universal rules still apply

Building Agents does not opt out of the project-wide rules:

- **All outputs go under the task's own folder** — `output_folder/{app_name}/`. Never write to the root of `output_folder/`.
- **`input_folder/` is sacred** — read source records from it, never modify them. Copy, don't move.
- **Every task folder gets `run_app.sh` + `run_app.bat`** — see "Launcher Scripts" below.

## Config files

- **`instructions.json`** — a named set of prompt templates. Each entry carries the system prompt, per-field rules, the model id, and `max_retries`. Adding a new behavior is usually a new entry here, not new code.
- **`output_schema.json`** — the JSON schema the model is constrained to (passed as `json_schema` strict response format). The prompt and the schema must stay in sync — derive shared values (e.g. an allowed-category list) from the schema so they can't drift.

## Extending an agent — add stages as named modules

When the user's prompt needs more than extract-and-store, add modules. The two common extensions:

### Code generation

To make an agent that writes and runs code against a table (e.g. "compute what % of spend was alcohol"):

| File | Change |
|---|---|
| `metadata_scanner.py` | **New.** Profiles the target table — column names, dtypes, top-10 unique values per categorical column, min/max/median per continuous column. Code-gen must see the data's shape to write code that references real columns. |
| `execute.py` | **New.** Runs the model-generated code in a subprocess/sandbox, captures stdout + stderr, and hands any traceback back to `retry`. Executing model-written code is the security-sensitive stage — always isolate it. |
| `prompt.py` | **Modified.** `build_prompt` accepts the metadata profile and injects it into a code-gen prompt template. |
| `retry.py` | **Modified.** The retry signal flips: instead of "reply is missing required fields," it becomes "the code threw — feed the traceback back and regenerate." The failure now originates in `execute`, so retry gains an `execute → retry` dependency. |
| `instructions.json` | **Modified.** Add a code-gen template entry. |
| `output_schema.json` | **Modified — and its role changes.** The reply is now *code*, not a record. Either constrain a thin envelope (`{ "code": "..." }`) or drop `json_schema` response format for the code-gen template entirely. |

The defining structural change: an extraction agent's retry validates the reply *internally*; a code-gen agent's retry validates by *running the code*. Design the `execute ⇄ retry` feedback loop deliberately — it is the heart of a code-gen agent.

### Narration

To add a final stage that turns a result into a verbose, human-readable summary:

| File | Change |
|---|---|
| `narrate.py` | **New.** Reads the analysis output, sends a **digest** (the metadata profile or the small result rows — never the raw table) to the model, requests free-form prose, and writes a `.md` / `.txt` narrative into `output_folder/{app_name}/`. |

Narration is a **plain text completion — no `json_schema` response format**, since the goal is prose, not a record. It has nothing to re-ask for on a bad reply, so it relies on the OpenAI SDK's built-in `max_retries` for network resilience rather than the field-validation or code-execution retry loops.

### Optional: `history.py`

An attempt/audit log — records each model round (prompt, code, result) for a task. Useful for debugging code-gen agents, where you want to see what code ran and what it returned. Add it when the agent's runs are worth auditing.

## Task-to-task chaining

An agent's output is a table, and a table is valid input for another task. An agent's `output_folder/{app_name}/` files (e.g. a classification ledger) may be consumed as the **input** of a downstream Track 1 pipeline or another agent.

This is a **task-to-task handoff** — the downstream task reads from another task's `output_folder/{task}/`, not from `input_folder/`. That is a sanctioned pattern: `input_folder/` holds *raw user data*; a prior task's `output_folder/{task}/` holds *derived data* and is a legitimate source for the next task.

## Launcher Scripts (REQUIRED)

Every agent task folder must contain `run_app.sh` and `run_app.bat` alongside `app.py` and the modules. Both just `cd` into the task folder and run the orchestrator:

**`run_app.sh`:**
```bash
#!/bin/bash
# Run: bash app_folder/scripts/{app_name}/run_app.sh
cd "$(dirname "$0")"
python app.py
```

**`run_app.bat`:**
```batch
@echo off
REM Run: app_folder\scripts\{app_name}\run_app.bat
cd /d "%~dp0"
python app.py
```

`run_app.sh` must be `chmod +x`. No `setup.sh`/`clear_cache.sh` are needed — agents are pure-Python with no Node dependency surface.
