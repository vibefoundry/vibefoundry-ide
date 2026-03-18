# Project Context

You are working in the project root with full access to all project files including input data, output results, and scripts.

## How to Understand the Data

When asked about the data (what's in it, what columns exist, what the data looks like, etc.):

1. **Read `app_folder/meta_data/input_metadata.txt`** - This contains descriptions of all available files, their columns, data types, and sample values
2. You can also directly read files from `input_folder/` if you need more details

## Answering Questions About Data

When asked a question that requires analyzing the data (e.g., "What are the top 10 states for sales?", "Which customers are most likely to churn?", "Show me the monthly trends"):

**Create and run a Python script** that:
1. Reads the relevant input file(s)
2. Performs the analysis
3. **Saves the result as a CSV to output_folder** (REQUIRED)

**Whenever you create a Python script to answer a question, always ensure that it has a dataframe output saved to the output_folder.** This is how results are displayed in the UI.

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

Using absolute paths ensures scripts work regardless of the current working directory.

## Metadata Files

The metadata files in `app_folder/meta_data/` contain:
- File paths for each data file
- File names and row counts
- Column names and data types
- Sample values

Metadata is automatically refreshed when files change.

## Launcher Scripts (.sh and .bat)

When building React apps, dashboards, or any application with a frontend/backend:

1. **Always create both launcher scripts** in `app_folder/scripts/`:
   - `run_app.sh` for macOS/Linux
   - `run_app.bat` for Windows

2. **Always include the run command as a comment at the top** of every .sh and .bat file:

**Shell script template (run_app.sh):**
```bash
#!/bin/bash
# Run: bash app_folder/scripts/run_app.sh

# Your startup logic here...
```

**Batch script template (run_app.bat):**
```batch
@echo off
REM Run: app_folder\scripts\run_app.bat

REM Your startup logic here...
```

This comment helps users understand how to run the script manually if needed.
