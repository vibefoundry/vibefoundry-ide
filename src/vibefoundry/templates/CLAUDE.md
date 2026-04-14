# Project Context

You are working in the project root with full access to all project files including input data, output results, and scripts.

## When to Plan vs. Just Do It

**Only present a plan when building something multi-step** (a new app, a dashboard, a pipeline). Keep plans short (3-7 steps), wait for approval, then execute one step at a time.

**For quick requests — analysis questions, graphs, single scripts — skip the plan and just do it.** Write the script, run it, save the output. Don't ask for permission on simple tasks.

**Never re-present or update the plan when the user asks a follow-up question.** A follow-up is a new task — just execute it directly. The plan was for the original build, not every subsequent request.

## Folder Structure

```
project_folder/           <- You are here
├── CLAUDE.md             <- This file
├── AGENTS.md             <- Instructions for OpenAI Codex
├── input_folder/         <- Source data files
├── output_folder/        <- Scripts save results here
└── app_folder/
    ├── meta_data/        <- Metadata describing available data
    └── scripts/          <- Save Python scripts here
```

## Answering Questions About Data

When asked a question that requires analyzing the data — just do it, no plan needed:

1. **Always create a `.py` script** in `app_folder/scripts/` — never run analysis inline
2. Read the relevant input file(s) using **Polars** (not Pandas)
3. Perform the analysis
4. **Save the result as a CSV to a timestamped output folder** (REQUIRED — this is how results appear in the UI)
5. Run the script

## Graphs and Visualizations

When asked for a chart, graph, or visualization — just do it, no plan needed:

1. **Always create a `.py` script** in `app_folder/scripts/` — never run plotting inline
2. Use **matplotlib** or **plotly** to create the chart
3. **Save the image to a timestamped output folder** (e.g., `output_folder/chart_20260412_143052/chart.png`)
4. Also save the underlying data as a CSV to the same folder so the user can see the numbers
5. Run the script

## Script Template

**Every `.py` file must start with a docstring** explaining what it does in 1-2 sentences:

```python
"""
Cleans the raw sales data by removing duplicates, fixing date formats,
and filtering out invalid entries. Outputs cleaned_sales.csv.
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

**Simple tasks** (one question, one chart, one output) → one script in its own folder, done.

**Multi-step tasks** (multiple outputs, transformations, or analyses) → break into separate `.py` files, each doing one job, chained together by a `{task}_app.py` orchestrator.

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

Every task gets its **own folder** inside `app_folder/scripts/`. The orchestrator is named **`{task}_app.py`**.

Example for "group by region and make a chart":

```
app_folder/scripts/
└── regional_analysis/
    ├── regional_analysis_app.py       <- Orchestrator — runs steps in order
    ├── step1_group_by_region.py       <- Groups data → saves aggregated CSV
    └── step2_chart.py                 <- Reads step1 CSV → creates chart image
```

Example for "clean, merge, analyze, and visualize":

```
app_folder/scripts/
└── sales_pipeline/
    ├── sales_pipeline_app.py          <- Orchestrator — runs steps in order
    ├── step1_clean_data.py            <- Reads raw data → saves cleaned CSV
    ├── step2_merge_datasets.py        <- Reads step1 CSV → saves merged CSV
    ├── step3_analyze.py               <- Reads step2 CSV → saves analysis CSV
    └── step4_visualize.py             <- Reads step3 CSV → saves chart image
```

Standalone single-script tasks also get their own folder:

```
app_folder/scripts/
└── quick_summary/
    └── quick_summary.py
```

### Key rule: every script produces output, every script reads from the previous step

The chain is always: **read input → do work → write output**. No script is "read-only."

- `step1` reads from `input_folder/`
- `step2` reads from `step1`'s output
- `step3` reads from `step2`'s output
- ...and so on

### Output folder naming convention:

The `_app.py` output folder is named after the **task folder** (not the `_app.py` file). Step outputs get subfolders named after their `.py` file — always inside the task's output folder, whether run by the `_app.py` or individually.

- `quick_summary_app.py` (in `quick_summary/`) → `output_folder/quick_summary/`
- `regional_analysis_app.py` (in `regional_analysis/`) → `output_folder/regional_analysis/`
- `step1_group_by_region.py` (orchestrated or individual) → `output_folder/regional_analysis/step1_group_by_region/`

No timestamps — each run overwrites the previous output.

#### Simple task — no steps (e.g., `quick_summary/quick_summary_app.py`):

```
output_folder/
└── quick_summary/
    └── summary.csv
```

#### Multi-step task (e.g., `regional_analysis/regional_analysis_app.py`):

Each step gets a subfolder named after its `.py` file.

```
output_folder/
└── regional_analysis/
    ├── step1_group_by_region/
    │   └── regional_summary.csv
    └── step2_chart/
        └── regional_chart.png
```

#### Simple `_app.py` example (`quick_summary/quick_summary_app.py`):

When a task is simple enough that it doesn't need steps, the `_app.py` does all the work itself.

```python
"""
Generates a quick summary of the dataset with row counts and column stats.
Outputs summary.csv.
"""
import os
import polars as pl

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(SCRIPT_DIR)))
INPUT_FOLDER = os.path.join(PROJECT_DIR, "input_folder")
OUTPUT_FOLDER = os.path.join(PROJECT_DIR, "output_folder")

# Output folder named after the task folder
TASK_NAME = os.path.basename(SCRIPT_DIR)
RUN_FOLDER = os.path.join(OUTPUT_FOLDER, TASK_NAME)
os.makedirs(RUN_FOLDER, exist_ok=True)

# Read input, do work, write output
df = pl.scan_csv(os.path.join(INPUT_FOLDER, "data.csv")).collect()
df.describe().write_csv(os.path.join(RUN_FOLDER, "summary.csv"))
print(f"Output saved to {RUN_FOLDER}")
```

#### Step script example (`step2_chart.py` — reads from previous step):

Step scripts **must work both ways**: run by the `_app.py` OR run individually. Use `os.environ.get()` with fallbacks — never `os.environ[]`. When run individually, steps write into the task's output folder (same location as when orchestrated).

- **Run by `_app.py`**: gets `VF_RUN_FOLDER` and `VF_PREV_STEP_FOLDER` from env
- **Run individually**: writes to `output_folder/{task}/{script_name}/`, reads from previous step's folder in the same task output

```python
"""
Reads the grouped regional data from step1 and creates a bar chart.
Outputs regional_chart.png.
"""
import os
import polars as pl
import matplotlib.pyplot as plt

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(SCRIPT_DIR)))
INPUT_FOLDER = os.path.join(PROJECT_DIR, "input_folder")
OUTPUT_FOLDER = os.path.join(PROJECT_DIR, "output_folder")

# Always write into the task's output folder
SCRIPT_NAME = os.path.splitext(os.path.basename(__file__))[0]
TASK_NAME = os.path.basename(os.path.dirname(os.path.abspath(__file__)))
TASK_OUTPUT = os.path.join(OUTPUT_FOLDER, TASK_NAME)
PREV_STEP_NAME = "step1_group_by_region"  # the step this script reads from

RUN_FOLDER = os.environ.get("VF_RUN_FOLDER", os.path.join(TASK_OUTPUT, SCRIPT_NAME))
PREV_STEP_FOLDER = os.environ.get("VF_PREV_STEP_FOLDER", os.path.join(TASK_OUTPUT, PREV_STEP_NAME))
os.makedirs(RUN_FOLDER, exist_ok=True)

prev_csv = os.path.join(PREV_STEP_FOLDER, "regional_summary.csv")
df = pl.read_csv(prev_csv)

# Create chart
fig, ax = plt.subplots()
ax.bar(df["region"], df["total_sales"])
ax.set_title("Sales by Region")
fig.savefig(os.path.join(RUN_FOLDER, "regional_chart.png"), dpi=150, bbox_inches="tight")
plt.close(fig)
print(f"Chart saved to {RUN_FOLDER}")
```

#### Multi-step `_app.py` example (`regional_analysis/regional_analysis_app.py`):

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

# Output folder named after the task folder
TASK_NAME = os.path.basename(SCRIPT_DIR)
RUN_FOLDER = os.path.join(OUTPUT_FOLDER, TASK_NAME)
os.makedirs(RUN_FOLDER, exist_ok=True)

steps = [
    "step1_group_by_region.py",
    "step2_chart.py",
]

prev_step_folder = INPUT_FOLDER  # step1 reads from input_folder

for step in steps:
    script = os.path.join(SCRIPT_DIR, step)
    step_name = step.replace(".py", "")
    step_folder = os.path.join(RUN_FOLDER, step_name)
    os.makedirs(step_folder, exist_ok=True)

    env = os.environ.copy()
    env["VF_RUN_FOLDER"] = step_folder
    env["VF_PREV_STEP_FOLDER"] = prev_step_folder

    print(f"\n{'='*40}")
    print(f" Running {step}...")
    print(f"{'='*40}\n")
    result = subprocess.run([sys.executable, script], env=env)
    if result.returncode != 0:
        print(f"\nError in {step} — stopping.")
        sys.exit(1)

    # Next step reads from this step's folder
    prev_step_folder = step_folder

print(f"\n{'='*40}")
print(f" All steps complete! Output: {RUN_FOLDER}")
print(f"{'='*40}")
```

### Rules:

- **Every task gets its own folder** inside `app_folder/scripts/` with a `{task}_app.py`
- **Every `_app.py` is the entry point** — simple tasks do the work directly, complex tasks orchestrate steps
- **Every script produces output** — no script is read-only
- **Steps always write into the task's output folder** — both when orchestrated and when run individually: `output_folder/{task}/{script_name}/`
- **Never use `os.environ[]`** — always use `os.environ.get()` with a fallback so scripts work with or without the `_app.py`
- **No timestamps** — each run overwrites the previous output
- **Output folder naming**: `_app.py` → `output_folder/{task}/`. Steps → `output_folder/{task}/{step_name}/`. Steps always land inside their task's output folder, never at the top level of `output_folder/`
- Naming: **`{task}_app.py`** (e.g., `regional_analysis_app.py`, not `main.py`)
- The `_app.py` passes two env vars to each step: `VF_RUN_FOLDER` (where to write) and `VF_PREV_STEP_FOLDER` (where to read)
- `step1` gets `VF_PREV_STEP_FOLDER=input_folder/` — subsequent steps get the previous step's subfolder
- Each step gets its own subfolder inside the task output, named after the `.py` file
- Name steps with a numbered prefix so execution order is obvious (`step1_`, `step2_`, etc.)
- `{task}_app.py` runs them in sequence and stops on failure
- `PROJECT_DIR` must account for the extra folder depth: `os.path.dirname()` x3 from `scripts/{task}/`
- Don't over-split — if two things are tightly coupled and under 150 lines total, keep them together

## Polars Rules

- Use `pl.scan_csv()` / `pl.scan_parquet()` for lazy loading — NOT `pl.read_csv()`
- Chain lazy operations, call `.collect()` only at the end
- Only fall back to Pandas if a specific library requires it

## Building Data Apps

When asked to build a dashboard or interactive tool, ask the user: **React + Python** or **Streamlit**?

### React + Python

- Backend (Flask/FastAPI) on **port 5000**, frontend on **port 3000**
- Backend must enable CORS for `http://localhost:3000`
- Use Polars for all backend data processing
- Paginate API endpoints that return data — never return full datasets
- Filter and sort server-side

```
project_folder/
├── backend/
│   ├── app.py              <- Flask/FastAPI backend (port 5000)
│   └── requirements.txt
├── frontend/
│   ├── package.json
│   └── src/
└── app_folder/scripts/
    ├── run_app.sh          <- macOS/Linux launcher
    └── run_app.bat         <- Windows launcher
```

#### Backend Template (backend/app.py)

```python
from flask import Flask, jsonify, request
from flask_cors import CORS
import polars as pl
import os
import json

app = Flask(__name__)
CORS(app, origins=["http://localhost:3000"])

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
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

@app.route("/api/health")
def health():
    return jsonify({"status": "ok"})

# Add your API routes here — always paginated, always server-side filtered

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
```

#### backend/requirements.txt

```
flask
flask-cors
polars
```

#### Frontend Setup

Use Create React App or Vite. In `package.json`, add a proxy for development:

```json
{
  "proxy": "http://localhost:5000"
}
```

#### Example: Paginated API Endpoint

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

### Streamlit

Place the script in `app_folder/scripts/`. The IDE detects and runs it automatically.

## Launcher Scripts (REQUIRED)

When building any app with a frontend/backend, you **MUST** create **6 launcher scripts** in `app_folder/scripts/`:

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
REM Run: app_folder\scripts\setup.bat
cd /d "%~dp0\..\.."

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
echo  Setup complete! Run: app_folder\scripts\run_app.bat
echo ========================================
```

### Windows Launcher (run_app.bat)

```batch
@echo off
REM Run: app_folder\scripts\run_app.bat
cd /d "%~dp0\..\.."

REM Check dependencies
if not exist "frontend\node_modules" (
    echo Dependencies not installed. Run setup.bat first.
    echo   app_folder\scripts\setup.bat
    exit /b 1
)

echo ========================================
echo  Launching App
echo ========================================

REM Kill any existing processes on ports 5000 and 3000
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :5000 ^| findstr LISTENING') do taskkill /PID %%a /F >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do taskkill /PID %%a /F >nul 2>&1

echo Starting app on http://localhost:3000 ...
cd frontend
call npx concurrently -n "backend,frontend" -c "blue,green" "cd /d \"%cd%\..\" && python backend\app.py" "npm run dev"
```

### Windows Clear Cache (clear_cache.bat)

```batch
@echo off
REM Run: app_folder\scripts\clear_cache.bat
cd /d "%~dp0\..\.."

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
# Run: bash app_folder/scripts/setup.sh
cd "$(dirname "$0")/../.."

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
echo " Setup complete! Run: bash app_folder/scripts/run_app.sh"
echo "========================================"
```

### macOS/Linux Launcher (run_app.sh)

```bash
#!/bin/bash
# Run: bash app_folder/scripts/run_app.sh
cd "$(dirname "$0")/../.."

# Check dependencies
if [ ! -d "frontend/node_modules" ]; then
    echo "Dependencies not installed. Run setup.sh first."
    echo "  bash app_folder/scripts/setup.sh"
    exit 1
fi

echo "========================================"
echo " Launching App"
echo "========================================"

# Kill any existing processes on ports 5000 and 3000
lsof -ti:5000 | xargs kill -9 2>/dev/null
lsof -ti:3000 | xargs kill -9 2>/dev/null

echo "Starting app on http://localhost:3000 ..."
cd frontend
npx concurrently -n "backend,frontend" -c "blue,green" \
    "cd .. && python backend/app.py" \
    "npm run dev"
```

### macOS/Linux Clear Cache (clear_cache.sh)

```bash
#!/bin/bash
# Run: bash app_folder/scripts/clear_cache.sh
cd "$(dirname "$0")/../.."

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
bash app_folder/scripts/setup.sh
```

### Non-React Apps (Simple Python Scripts or Streamlit)

For simple scripts without a frontend, only `run_app` scripts are needed (no setup/clear_cache):

**run_app.bat:**
```batch
@echo off
REM Run: app_folder\scripts\run_app.bat
cd /d "%~dp0\..\.."
python app_folder\scripts\your_script.py
```

**run_app.sh:**
```bash
#!/bin/bash
# Run: bash app_folder/scripts/run_app.sh
cd "$(dirname "$0")/../.."
python app_folder/scripts/your_script.py
```
