# Project Context

You are working inside a **virtual environment** in `app_folder/`. The raw data files are stored locally on the user's machine and are not directly accessible to you.

## CRITICAL: Never Run Scripts

**DO NOT run Python scripts.** You can only write them. The user will run the scripts locally where the data exists.

## CRITICAL: Folder Access Rules

**NEVER access `../input_folder/` or `../output_folder/` directly.**

- Do NOT read files from input_folder
- Do NOT list files in input_folder or output_folder
- Do NOT browse or explore those directories

## How to Understand the Data

When asked ANY question about the data (what's in it, what columns exist, what the data looks like, etc.):

1. **Read `meta_data/input_metadata.txt`** - This contains descriptions of all available files, their columns, data types, and sample values
2. Use this metadata to understand what data is available without accessing the raw files

## Answering Questions About Data

When asked a question that requires analyzing the data (e.g., "What are the top 10 states for sales?", "Which customers are most likely to churn?", "Show me the monthly trends"):

**ALWAYS respond with a Python script** that:
1. Reads the relevant input file(s)
2. Performs the analysis
3. **Saves the result as a CSV to output_folder** (REQUIRED)

**Whenever you create a Python script to answer a question, always ensure that it has a dataframe output saved to the output_folder.** This is how the user sees the results.

Do NOT attempt to answer data questions directly - you cannot see the raw data. Instead, write a script that will produce the answer when the user runs it.

## Folder Structure

```
project_folder/
├── input_folder/      <- DO NOT ACCESS (local data)
├── output_folder/     <- Scripts save results here
└── app_folder/        <- You are here
    ├── meta_data/     <- Read this to understand available data
    └── scripts/       <- Save Python scripts here
```

## Script Template

**ALWAYS use this template** so scripts work from any directory:

```python
import os
import pandas as pd

# Get absolute paths (works from any directory)
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(os.path.dirname(SCRIPT_DIR))
INPUT_FOLDER = os.path.join(PROJECT_DIR, "input_folder")
OUTPUT_FOLDER = os.path.join(PROJECT_DIR, "output_folder")

# Read input files using absolute paths
df = pd.read_csv(os.path.join(INPUT_FOLDER, "your_file.csv"))

# Perform analysis
result = df.groupby("column").sum()

# ALWAYS save result to output folder
result.to_csv(os.path.join(OUTPUT_FOLDER, "result.csv"), index=False)
print(f"Saved result to {os.path.join(OUTPUT_FOLDER, 'result.csv')}")
```

**NEVER use relative paths like `../input_folder/`** - they break when scripts are run from different directories.

## Refreshing Metadata

Run `python metadatafarmer.py` to refresh metadata after new files are added.

The metadata files contain:
- Absolute paths for each file
- File names and row counts
- Column names and data types
- Sample values

## Startup Script Templates

When building a full-stack app (FastAPI backend + frontend), **always create both startup scripts** at `app_folder/scripts/run_app.bat` (Windows) and `app_folder/scripts/run_app.sh` (Linux/Mac).

Replace `My App` and the port numbers if your app uses different values.

### Windows — `app_folder/scripts/run_app.bat`

```bat
@echo off
REM Run: app_folder\scripts\run_app.bat

set SCRIPT_DIR=%~dp0
set APP_DIR=%SCRIPT_DIR%..
set BACKEND_DIR=%APP_DIR%\backend
set FRONTEND_DIR=%APP_DIR%\frontend
set PYTHON_EXE=%BACKEND_DIR%\venv\Scripts\python.exe
set PYTHON_BOOTSTRAP=
set APP_NAME=My App

echo [run_app] Starting %APP_NAME%...

REM 0) Close any running instances on ports 8000 and 5173
echo [run_app] Closing any existing instances...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8000 "') do taskkill /F /PID %%a >nul 2>nul
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5173 "') do taskkill /F /PID %%a >nul 2>nul

REM 1) Clear cache and static files from previous builds
echo [run_app] Clearing cache and build artifacts...
if exist "%FRONTEND_DIR%\dist" rmdir /s /q "%FRONTEND_DIR%\dist"
if exist "%FRONTEND_DIR%\node_modules\.cache" rmdir /s /q "%FRONTEND_DIR%\node_modules\.cache"
for /d /r "%BACKEND_DIR%" %%d in (__pycache__) do @if exist "%%d" rmdir /s /q "%%d"

REM 2) Find a Python launcher for venv creation
where py >nul 2>nul
if not errorlevel 1 set PYTHON_BOOTSTRAP=py
if "%PYTHON_BOOTSTRAP%"=="" (
  where python >nul 2>nul
  if not errorlevel 1 set PYTHON_BOOTSTRAP=python
)
if "%PYTHON_BOOTSTRAP%"=="" (
  where python3 >nul 2>nul
  if not errorlevel 1 set PYTHON_BOOTSTRAP=python3
)

REM 3) Create backend virtual environment if needed
if not exist "%PYTHON_EXE%" (
  if "%PYTHON_BOOTSTRAP%"=="" (
    echo [run_app] Python was not found in PATH.
    echo [run_app] Install Python 3 and rerun this script.
    exit /b 1
  )
  echo [run_app] Creating backend virtual environment...
  %PYTHON_BOOTSTRAP% -m venv "%BACKEND_DIR%\venv"
  if errorlevel 1 (
    echo [run_app] Failed to create backend virtual environment.
    exit /b 1
  )
)

REM 4) Install backend dependencies
echo [run_app] Installing backend dependencies...
pushd "%BACKEND_DIR%"
call "%PYTHON_EXE%" -m pip install -q -r requirements.txt
if errorlevel 1 (
  echo [run_app] Failed to install backend dependencies.
  popd
  exit /b 1
)

REM 5) Start backend in a separate window
echo [run_app] Starting backend server on http://localhost:8000...
start "%APP_NAME% Backend" /D "%BACKEND_DIR%" cmd /k ""%PYTHON_EXE%" -m uvicorn main:app --host 0.0.0.0 --port 8000"
popd

REM 6) Wait for backend health endpoint
echo [run_app] Waiting for backend to be ready...
powershell -NoProfile -Command "$ok=$false; for($i=0;$i -lt 30;$i++){ try { Invoke-WebRequest -UseBasicParsing http://localhost:8000/api/health | Out-Null; $ok=$true; break } catch { Start-Sleep -Seconds 1 } }; if(-not $ok){ exit 1 }"
if errorlevel 1 (
  echo [run_app] Backend did not become ready in time.
  exit /b 1
)

REM 7) Install frontend dependencies
pushd "%FRONTEND_DIR%"
echo [run_app] Installing frontend dependencies...
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo [run_app] Failed to install frontend dependencies.
  popd
  exit /b 1
)

REM 8) Open browser
echo [run_app] Opening browser at http://localhost:5173...
start "" "http://localhost:5173"

REM 9) Start frontend dev server
echo [run_app] Starting frontend dev server on http://localhost:5173...
call npm run dev
if errorlevel 1 (
  echo [run_app] Frontend server failed to start.
  popd
  exit /b 1
)
popd
```

### Linux/Mac — `app_folder/scripts/run_app.sh`

```bash
#!/bin/bash
# Run: app_folder/scripts/run_app.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
BACKEND_DIR="$APP_DIR/backend"
FRONTEND_DIR="$APP_DIR/frontend"
PYTHON_EXE="$BACKEND_DIR/venv/bin/python"
APP_NAME="My App"

echo "[run_app] Starting $APP_NAME..."

# 0) Close any running instances on ports 8000 and 5173
echo "[run_app] Closing any existing instances..."
lsof -ti:8000 | xargs kill -9 2>/dev/null || true
lsof -ti:5173 | xargs kill -9 2>/dev/null || true

# 1) Clear cache and static files from previous builds
echo "[run_app] Clearing cache and build artifacts..."
rm -rf "$FRONTEND_DIR/dist"
rm -rf "$FRONTEND_DIR/node_modules/.cache"
find "$BACKEND_DIR" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true

# 2) Find Python
PYTHON_BOOTSTRAP=""
if command -v python3 &>/dev/null; then
  PYTHON_BOOTSTRAP=python3
elif command -v python &>/dev/null; then
  PYTHON_BOOTSTRAP=python
fi

# 3) Create backend virtual environment if needed
if [ ! -f "$PYTHON_EXE" ]; then
  if [ -z "$PYTHON_BOOTSTRAP" ]; then
    echo "[run_app] Python was not found in PATH. Install Python 3 and rerun."
    exit 1
  fi
  echo "[run_app] Creating backend virtual environment..."
  $PYTHON_BOOTSTRAP -m venv "$BACKEND_DIR/venv" || { echo "[run_app] Failed to create venv."; exit 1; }
fi

# 4) Install backend dependencies
echo "[run_app] Installing backend dependencies..."
"$PYTHON_EXE" -m pip install -q -r "$BACKEND_DIR/requirements.txt" || { echo "[run_app] Failed to install backend dependencies."; exit 1; }

# 5) Start backend in background
echo "[run_app] Starting backend server on http://localhost:8000..."
cd "$BACKEND_DIR"
"$PYTHON_EXE" -m uvicorn main:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!
cd "$SCRIPT_DIR"

# 6) Wait for backend health endpoint
echo "[run_app] Waiting for backend to be ready..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:8000/api/health >/dev/null 2>&1; then
    echo "[run_app] Backend is ready."
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "[run_app] Backend did not become ready in time."
    kill "$BACKEND_PID" 2>/dev/null || true
    exit 1
  fi
  sleep 1
done

# 7) Install frontend dependencies
echo "[run_app] Installing frontend dependencies..."
cd "$FRONTEND_DIR"
npm install --no-audit --no-fund || { echo "[run_app] Failed to install frontend dependencies."; exit 1; }

# 8) Open browser
echo "[run_app] Opening browser at http://localhost:5173..."
if command -v open &>/dev/null; then
  open "http://localhost:5173"
elif command -v xdg-open &>/dev/null; then
  xdg-open "http://localhost:5173"
fi

# 9) Start frontend dev server (foreground — keeps the terminal alive)
echo "[run_app] Starting frontend dev server on http://localhost:5173..."
npm run dev
```
