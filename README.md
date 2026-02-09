# VibeFoundry IDE

A local desktop IDE for data analysis with Claude Code running in a GitHub Codespace sandbox.

## Features

- **Local File Management** - Browse and manage your project files
- **Codespace Integration** - Connect to a GitHub Codespace running Claude Code
- **Script Runner** - Run Python scripts locally with auto-preview of outputs
- **Data Preview** - View CSV, Excel, and image files directly in the IDE
- **Bidirectional Sync** - Scripts sync between local and codespace

## Installation

```bash
# Install the package
pip install -e .

# Build the frontend
cd frontend && npm install && npm run build && cd ..
```

## Usage

```bash
# Launch the IDE
vibefoundry

# Or specify a project folder
vibefoundry /path/to/project
```

## Development

```bash
# Run frontend dev server
cd frontend && npm run dev

# Run backend separately
python -m vibefoundry.server
```

## Architecture

- `frontend/` - React-based UI (Vite + React)
- `src/vibefoundry/` - Python backend (FastAPI)
  - `server.py` - Main API server
  - `watcher.py` - File change detection
  - `runner.py` - Script execution
  - `metadata.py` - Metadata generation
