# Project Context

You are working in the project root with full access to all project files including input data, output results, and scripts.

## When to Plan vs. Just Do It

**Only present a plan when building something multi-step** (a new app, a dashboard, a pipeline). Keep plans short (3-7 steps), wait for approval, then execute one step at a time.

**For quick requests — analysis questions, graphs, single scripts — skip the plan and just do it.** Write the script, run it, save the output. Don't ask for permission on simple tasks.

**Never re-present or update the plan when the user asks a follow-up question.** A follow-up is a new task — just execute it directly. The plan was for the original build, not every subsequent request.

## Folder Structure

```
project_folder/           <- You are here
├── CLAUDE.md             <- Instructions for Claude Code
├── AGENTS.md             <- This file
├── input_folder/         <- Source data files
├── output_folder/        <- Scripts save results here
└── app_folder/
    ├── meta_data/        <- Metadata describing available data
    └── scripts/          <- Save Python scripts here
```

## Answering Questions About Data

When asked a question that requires analyzing the data — just do it, no plan needed:

1. Read the relevant input file(s) using **Polars** (not Pandas)
2. Perform the analysis
3. **Save the result as a CSV to `output_folder/`** (REQUIRED — this is how results appear in the UI)

## Graphs and Visualizations

When asked for a chart, graph, or visualization — just do it, no plan needed:

1. Use **matplotlib** or **plotly** to create the chart
2. **Save the image to `output_folder/`** (e.g., `output_folder/chart.png`)
3. Also save the underlying data as a CSV to `output_folder/` so the user can see the numbers

## Script Template

**Use this path template** so scripts work from any directory:

```python
import os
import polars as pl

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(os.path.dirname(SCRIPT_DIR))
INPUT_FOLDER = os.path.join(PROJECT_DIR, "input_folder")
OUTPUT_FOLDER = os.path.join(PROJECT_DIR, "output_folder")
```

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

When building any app with a frontend/backend, you **MUST** create both launcher scripts in `app_folder/scripts/`. These scripts are how the IDE runs your app.

### CRITICAL rules for launcher scripts:

1. **Always create BOTH** `run_app.sh` and `run_app.bat`
2. **Always include the run command as a comment at the top**
3. **Always kill existing processes on ports 5000 and 3000 before starting**
4. **Always install dependencies before launching**
5. **Always use `call` before `npm` commands in .bat files** (without `call`, the .bat exits after npm runs)
6. **Always use `cd /d` in .bat files** (handles drive letter changes on Windows)
7. **Always use named windows with `start "Name"`** so students can identify them

### Windows Launcher (run_app.bat)

```batch
@echo off
REM Run: app_folder\scripts\run_app.bat

REM Navigate to project root
cd /d "%~dp0\..\.."

echo ========================================
echo  Launching App
echo ========================================

REM Kill any existing processes on ports 5000 and 3000
echo Cleaning up old processes...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :5000 ^| findstr LISTENING') do taskkill /PID %%a /F >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do taskkill /PID %%a /F >nul 2>&1

REM Install Python dependencies
echo Installing Python dependencies...
pip install -r backend\requirements.txt -q

REM Install Node dependencies (skip if already installed)
if not exist "frontend\node_modules" (
    echo Installing Node dependencies...
    cd frontend
    call npm install --silent
    cd ..
) else (
    echo Node dependencies already installed, skipping...
)

REM Start backend in a new named window
echo Starting backend on http://localhost:5000 ...
start "Backend - Port 5000" cmd /k "cd /d "%cd%" && python backend\app.py"

REM Wait for backend to initialize
timeout /t 3 >nul

REM Start frontend in a new named window
echo Starting frontend on http://localhost:3000 ...
start "Frontend - Port 3000" cmd /k "cd /d "%cd%\frontend" && call npm start"

echo ========================================
echo  App is starting!
echo  Backend:  http://localhost:5000
echo  Frontend: http://localhost:3000
echo ========================================
```

### macOS/Linux Launcher (run_app.sh)

```bash
#!/bin/bash
# Run: bash app_folder/scripts/run_app.sh

# Navigate to project root
cd "$(dirname "$0")/../.."

echo "========================================"
echo " Launching App"
echo "========================================"

# Kill any existing processes on ports 5000 and 3000
echo "Cleaning up old processes..."
lsof -ti:5000 | xargs kill -9 2>/dev/null
lsof -ti:3000 | xargs kill -9 2>/dev/null

# Install Python dependencies
echo "Installing Python dependencies..."
pip install -r backend/requirements.txt -q

# Install Node dependencies (skip if already installed)
if [ ! -d "frontend/node_modules" ]; then
    echo "Installing Node dependencies..."
    cd frontend
    npm install --silent
    cd ..
else
    echo "Node dependencies already installed, skipping..."
fi

# Start backend in background
echo "Starting backend on http://localhost:5000 ..."
python backend/app.py &
BACKEND_PID=$!

# Wait for backend to initialize
sleep 3

# Start frontend (this opens the browser automatically)
echo "Starting frontend on http://localhost:3000 ..."
cd frontend
npm start

# When frontend is stopped (Ctrl+C), also kill backend
kill $BACKEND_PID 2>/dev/null
```

### Non-React Apps (Simple Python Scripts or Streamlit)

**run_app.bat:**
```batch
@echo off
REM Run: app_folder\scripts\run_app.bat
cd /d "%~dp0\..\.."
pip install -r requirements.txt -q
python app_folder\scripts\your_script.py
```

**run_app.sh:**
```bash
#!/bin/bash
# Run: bash app_folder/scripts/run_app.sh
cd "$(dirname "$0")/../.."
pip install -r requirements.txt -q
python app_folder/scripts/your_script.py
```
