# Project Context

You are working in the project root with full access to all project files including input data, output results, and scripts.

## Workflow: Plan First, Then Execute

**EVERY user request MUST start with a plan.** Do NOT immediately start writing code.

**If you are Claude Code, enter plan mode (`/plan`) before creating any application.** Use plan mode to design the architecture, identify data sources, define API endpoints, and outline the frontend components. Only exit plan mode and begin coding after the user approves the plan.

1. **Present a numbered plan** outlining what you will build, in what order, and why
2. **Wait for user approval** before executing each step
3. **Execute one step at a time**, showing the user results after each step
4. **Save intermediate outputs to `output_folder/`** so the user can review data at each stage

**Build order for data apps:**
1. Understand the data (read metadata, explore input files)
2. Build data processing pipelines first — clean, transform, aggregate
3. Save processed outputs to `output_folder/` for user review
4. Only after the data layer is solid, build the frontend (React or Streamlit)
5. Create launcher scripts last

**Exception:** If the user explicitly says "just do it" or "build it all at once", execute the full plan without pausing for approval.

## How to Understand the Data

When asked about the data (what's in it, what columns exist, what the data looks like, etc.):

1. **Read `app_folder/meta_data/input_metadata.txt`** - This contains descriptions of all available files, their columns, data types, and sample values
2. You can also directly read files from `input_folder/` if you need more details

## Answering Questions About Data

When asked a question that requires analyzing the data (e.g., "What are the top 10 states for sales?", "Which customers are most likely to churn?", "Show me the monthly trends"):

**Create and run a Python script** that:
1. Reads the relevant input file(s) using **Polars** (not Pandas)
2. Performs the analysis
3. **Saves the result as a CSV to output_folder** (REQUIRED)

**Whenever you create a Python script to answer a question, always ensure that it has a dataframe output saved to the output_folder.** This is how results are displayed in the UI.

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

## Use Polars, Not Pandas

**Always use Polars for all data processing.** Polars is faster, uses less memory, and supports lazy evaluation for big data.

### Script Template

**ALWAYS use this template** so scripts work from any directory:

```python
import os
import polars as pl

# Get absolute paths (works from any directory)
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(os.path.dirname(SCRIPT_DIR))
INPUT_FOLDER = os.path.join(PROJECT_DIR, "input_folder")
OUTPUT_FOLDER = os.path.join(PROJECT_DIR, "output_folder")

# Read input files using lazy evaluation (never loads full file into memory)
lf = pl.scan_csv(os.path.join(INPUT_FOLDER, "your_file.csv"))

# Perform analysis using lazy operations
result = lf.group_by("column").agg(pl.col("value").sum()).collect()

# ALWAYS save result to output folder
result.write_csv(os.path.join(OUTPUT_FOLDER, "result.csv"))
print(f"Saved result to {os.path.join(OUTPUT_FOLDER, 'result.csv')}")
```

### Polars Rules

- **Use `pl.scan_csv()` / `pl.scan_parquet()`** for lazy loading — NOT `pl.read_csv()`
- **Chain lazy operations** (filter, group_by, select, sort) before calling `.collect()`
- **Use `.collect()` only at the end** when you need the final result
- **Use `.sink_csv()` / `.sink_parquet()`** for writing large results without loading into memory
- **Use `pl.col()` expressions** — avoid Python loops over rows
- Only fall back to Pandas if a specific library requires a Pandas DataFrame (e.g., some ML libraries)

## Big Data Best Practices

Data files may be very large (millions of rows, gigabytes). Follow these practices for ALL data processing and app development.

### Data Processing Scripts

- **Lazy evaluation first**: Always start with `pl.scan_csv()` / `pl.scan_parquet()`, chain operations, `.collect()` at the end
- **Filter early**: Apply filters as early as possible in the chain to reduce data volume
- **Select only needed columns**: Use `.select()` to pick only the columns you need — don't process the entire dataframe
- **Aggregate before saving**: Don't save raw data to output — save summaries, aggregations, and results
- **Use Parquet for intermediate files**: When saving processed data that will be re-read, use `.write_parquet()` instead of `.write_csv()` — it's smaller and faster to read

### React + Python App Backends

When building Flask/FastAPI backends that serve data to a React frontend:

- **Never load entire datasets into memory on startup** — use `pl.scan_csv()` / `pl.scan_parquet()` and query on demand
- **Paginated API endpoints** — always accept `page` and `page_size` parameters, return chunks (e.g., 100-500 rows), never return full datasets
- **Server-side filtering** — accept filter parameters in the API, apply them with Polars lazy evaluation, return only matching rows
- **Server-side sorting** — sort on the backend, not in the browser
- **Precompute summary statistics** — calculate totals, averages, distributions on server startup or on first request, cache the results
- **Cache expensive queries** — use a simple dict cache with a TTL or file-mtime invalidation. If the input file hasn't changed, return the cached result.
- **Cascading filters** — when one filter is applied, recompute the available options for other filters based on the filtered data
- **Concurrent processing** — when an endpoint needs data from multiple files or multiple independent computations, use `concurrent.futures.ThreadPoolExecutor` to process them in parallel instead of sequentially
- **Chunked processing for large files** — when a single file is too large to process at once, split the work into chunks using Polars `.slice()` or process in batches, then combine results

### Concurrent Processing Example

```python
from concurrent.futures import ThreadPoolExecutor, as_completed

def get_summary(file_path):
    """Compute summary for a single file."""
    lf = pl.scan_csv(file_path)
    return lf.select([
        pl.col("revenue").sum().alias("total_revenue"),
        pl.len().alias("row_count"),
    ]).collect()

@app.route("/api/dashboard")
def dashboard():
    data_files = [f for f in os.listdir(INPUT_FOLDER) if f.endswith(".csv")]
    results = {}

    # Process all files concurrently
    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = {
            executor.submit(get_summary, os.path.join(INPUT_FOLDER, f)): f
            for f in data_files
        }
        for future in as_completed(futures):
            fname = futures[future]
            results[fname] = future.result().to_dicts()[0]

    return jsonify(results)
```

### Chunked Processing Example

```python
def process_large_file(file_path, chunk_size=100_000):
    """Process a large CSV in chunks and combine results."""
    lf = pl.scan_csv(file_path)
    total_rows = lf.select(pl.len()).collect().item()

    all_results = []
    for offset in range(0, total_rows, chunk_size):
        chunk = lf.slice(offset, chunk_size).collect()
        # Process each chunk
        result = chunk.group_by("category").agg(pl.col("value").sum())
        all_results.append(result)

    # Combine all chunk results
    combined = pl.concat(all_results).group_by("category").agg(pl.col("value").sum())
    return combined
```

### React Frontend

- **Never fetch all rows at once** — use paginated API calls, load more on scroll or button click
- **Lazy load components** — only render what's visible (virtual scrolling for tables)
- **Show loading states** — indicate when data is being fetched
- **Debounce filter/search inputs** — don't fire an API call on every keystroke, wait 300ms

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

## Metadata Files

The metadata files in `app_folder/meta_data/` contain:
- File paths for each data file
- File names and row counts
- Column names and data types
- Sample values

Metadata is automatically refreshed when files change.

## Building Data Apps

When asked to build a dashboard, data app, or interactive tool, the user will choose between **React + Python** or **Streamlit**. If not specified, ask.

### Option 1: React + Python (recommended for production-quality apps)

Follow this architecture exactly.

#### App Folder Structure

```
project_folder/
├── CLAUDE.md
├── AGENTS.md
├── input_folder/
├── output_folder/
├── backend/
│   ├── app.py              <- Flask/FastAPI backend (port 5000)
│   └── requirements.txt    <- Python dependencies
├── frontend/
│   ├── package.json
│   ├── public/
│   └── src/
│       ├── App.js
│       └── index.js
└── app_folder/
    ├── meta_data/
    └── scripts/
        ├── run_app.sh      <- macOS/Linux launcher
        └── run_app.bat     <- Windows launcher
```

#### Rules

- **Backend MUST run on port 5000**
- **Frontend MUST run on port 3000**
- Backend must enable CORS for `http://localhost:3000`
- Frontend API calls must target `http://localhost:5000`
- All dependencies go in `requirements.txt` and `package.json`
- **Use Polars for all data processing in the backend**
- **All API endpoints that return data MUST be paginated**
- **All filtering and sorting MUST happen server-side**

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

### Option 2: Streamlit

For quick prototypes and simple dashboards. Build Streamlit apps as normal — no special architecture required. Place the script in `app_folder/scripts/` and the IDE will detect and run it automatically.

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

REM Install Node dependencies
echo Installing Node dependencies...
cd frontend
call npm install --silent
cd ..

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

# Install Node dependencies
echo "Installing Node dependencies..."
cd frontend
npm install --silent
cd ..

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

For simple Python scripts or Streamlit apps, the launcher is simpler:

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
