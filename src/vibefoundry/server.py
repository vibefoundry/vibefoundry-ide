"""
FastAPI backend server for VibeFoundry IDE
"""

import os
import sys
import json
import asyncio
import struct
import signal
import time
from pathlib import Path

# Unix-only imports for terminal functionality
if sys.platform != 'win32':
    import pty
    import fcntl
    import termios
    import select
else:
    pty = None
    fcntl = None
    termios = None
    select = None
from typing import Optional
from contextlib import asynccontextmanager

import httpx
import polars as pl
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, UploadFile, File, Form
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from vibefoundry.runner import discover_scripts, run_script, setup_project_structure, ScriptResult, stop_all_scripts, list_running_processes, stop_process
from vibefoundry.metadata import generate_metadata
from vibefoundry.watcher import FileWatcher


# Global state
class AppState:
    project_folder: Optional[Path] = None
    watcher: Optional[FileWatcher] = None
    websocket_clients: list[WebSocket] = []
    # Debounce for script change notifications (prevent duplicates)
    last_script_change: dict[str, float] = {}  # path -> timestamp


class DataFrameState:
    """Stream-from-disk DataFrame viewer - only loads rows as needed"""
    def __init__(self):
        self.file_path: Optional[str] = None
        self.file_type: Optional[str] = None  # 'csv' or 'excel'
        self.csv_separator: str = ','
        self.columns: list[str] = []
        self.column_info: dict = {}  # {col: {type, min, max, values}}
        self.total_rows: int = 0
        self.current_filters: dict = {}
        self.current_sort: Optional[dict] = None
        # Small cache for filtered row count (avoids re-scanning)
        self._filtered_row_count: Optional[int] = None

    def clear(self):
        """Clear state"""
        print(f"[Memory] Clearing DataFrame state")
        self.file_path = None
        self.file_type = None
        self.csv_separator = ','
        self.columns = []
        self.column_info = {}
        self.total_rows = 0
        self.current_filters = {}
        self.current_sort = None
        self._filtered_row_count = None

    def _get_lazy_frame(self) -> Optional[pl.LazyFrame]:
        """Get a lazy frame for the file (doesn't load data)"""
        if not self.file_path:
            return None
        file_path = Path(self.file_path)
        if self.file_type == 'csv':
            return pl.scan_csv(file_path, separator=self.csv_separator, infer_schema_length=10000)
        elif self.file_type == 'excel':
            # Excel doesn't support lazy scanning, load eagerly but this is rare
            return pl.read_excel(file_path).lazy()
        return None

    def _apply_filters_sort(self, lf: pl.LazyFrame) -> pl.LazyFrame:
        """Apply current filters and sort to a lazy frame"""
        # Apply filters
        for column, filter_val in self.current_filters.items():
            if column not in self.columns:
                continue
            if isinstance(filter_val, dict):
                # Numeric range filter
                if filter_val.get('min') not in (None, '', 'null'):
                    try:
                        min_val = float(filter_val['min'])
                        lf = lf.filter(pl.col(column).cast(pl.Float64, strict=False) >= min_val)
                    except (ValueError, TypeError):
                        pass
                if filter_val.get('max') not in (None, '', 'null'):
                    try:
                        max_val = float(filter_val['max'])
                        lf = lf.filter(pl.col(column).cast(pl.Float64, strict=False) <= max_val)
                    except (ValueError, TypeError):
                        pass
            elif isinstance(filter_val, list) and len(filter_val) > 0:
                # Categorical filter
                str_vals = [str(v) for v in filter_val]
                lf = lf.filter(pl.col(column).cast(pl.Utf8).is_in(str_vals))

        # Apply sort
        if self.current_sort and self.current_sort.get('column'):
            sort_col = self.current_sort['column']
            descending = self.current_sort.get('direction', 'asc') != 'asc'
            if sort_col in self.columns:
                lf = lf.sort(sort_col, descending=descending, nulls_last=True)

        return lf

    def get_rows(self, offset: int, limit: int) -> tuple[list[dict], int]:
        """Get rows with current filters/sort applied. Returns (rows, total_filtered_count)"""
        lf = self._get_lazy_frame()
        if lf is None:
            return [], 0

        lf = self._apply_filters_sort(lf)

        # Get total count (cached if no filter changes)
        if self._filtered_row_count is None:
            self._filtered_row_count = lf.select(pl.len()).collect().item()

        # Get requested slice
        rows_df = lf.slice(offset, limit).collect()
        rows = rows_df.to_dicts()

        # Replace None with empty string
        for row in rows:
            for key in row:
                if row[key] is None:
                    row[key] = ''

        return rows, self._filtered_row_count

    def invalidate_filter_cache(self):
        """Call when filters change"""
        self._filtered_row_count = None


state = AppState()
df_state = DataFrameState()


# Request/Response models
class FolderSelectRequest(BaseModel):
    path: str


class RunScriptsRequest(BaseModel):
    scripts: list[str]


class ScriptResultResponse(BaseModel):
    script_path: str
    success: bool
    stdout: str
    stderr: str
    return_code: int
    error: Optional[str] = None
    timed_out: bool = False
    streamlit_url: Optional[str] = None  # URL if this was a Streamlit app


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events"""
    # Check for project folder from environment
    project_path = os.environ.get("VIBEFOUNDRY_PROJECT_PATH")
    if project_path:
        folder = Path(project_path)
        if folder.exists() and folder.is_dir():
            state.project_folder = folder
            setup_project_structure(folder)
            generate_metadata(folder)
            state.watcher = FileWatcher(folder)
            state.watcher.scan_initial_state()

    yield
    # Cleanup
    if state.watcher:
        state.watcher.stop()
    # Stop any running scripts (including Streamlit apps)
    stopped = stop_all_scripts()
    if stopped:
        print(f"[Shutdown] Stopped {stopped} running script(s)")


# Create FastAPI app
app = FastAPI(
    title="VibeFoundry IDE",
    version="0.1.0",
    lifespan=lifespan
)

# CORS for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_static_dir() -> Path:
    """Get the path to bundled static files"""
    return Path(__file__).parent / "static"


# API Routes

@app.get("/api/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "ok", "project_folder": str(state.project_folder) if state.project_folder else None}


class LaunchTerminalRequest(BaseModel):
    path: str
    launch_claude: bool = True


@app.post("/api/terminal/launch")
async def launch_native_terminal(request: LaunchTerminalRequest):
    """Launch a native terminal window, cd into the project, and optionally launch claude"""
    import subprocess

    folder_path = Path(request.path)
    if not folder_path.exists():
        raise HTTPException(status_code=400, detail="Folder does not exist")

    if sys.platform == 'darwin':  # macOS
        # Use AppleScript to open Terminal.app with commands
        if request.launch_claude:
            script = f'''
            tell application "Terminal"
                activate
                do script "cd \\"{folder_path}\\" && clear && claude"
            end tell
            '''
        else:
            script = f'''
            tell application "Terminal"
                activate
                do script "cd \\"{folder_path}\\" && clear"
            end tell
            '''
        subprocess.run(['osascript', '-e', script], check=True)
        return {"status": "ok", "message": "Terminal launched"}
    else:
        raise HTTPException(status_code=400, detail="Native terminal launch only supported on macOS")


@app.post("/api/folder/select")
async def select_folder(request: FolderSelectRequest):
    """Set the project folder and initialize structure"""
    folder_path = Path(request.path)

    if not folder_path.exists():
        raise HTTPException(status_code=400, detail="Folder does not exist")

    if not folder_path.is_dir():
        raise HTTPException(status_code=400, detail="Path is not a directory")

    state.project_folder = folder_path

    # Don't auto-scaffold - user must click Build button
    # Just ensure basic folders exist for watcher
    folders = {
        "input_folder": folder_path / "input_folder",
        "output_folder": folder_path / "output_folder",
        "app_folder": folder_path / "app_folder",
        "scripts_folder": folder_path / "app_folder" / "scripts",
    }

    # Stop existing watcher
    if state.watcher:
        state.watcher.stop()

    # Start new watcher
    # Note: Pass coroutines directly - watcher.py handles thread-safe scheduling
    state.watcher = FileWatcher(
        folder_path,
        on_data_change=notify_data_change,
        on_script_change=notify_script_change,
        on_output_file_change=notify_output_file_change
    )
    await state.watcher.start_async()

    # Generate initial metadata
    generate_metadata(folder_path)

    return {
        "success": True,
        "name": folder_path.name,
        "project_folder": str(folder_path),
        "folders": {k: str(v) for k, v in folders.items()}
    }


@app.get("/api/folder/info")
async def get_folder_info():
    """Get current project folder info"""
    if not state.project_folder:
        return {"project_folder": None}

    return {
        "project_folder": str(state.project_folder),
        "name": state.project_folder.name
    }


@app.post("/api/build")
async def build_project():
    """Build the project structure - creates folders and copies CLAUDE.md"""
    if not state.project_folder:
        raise HTTPException(status_code=400, detail="No project folder selected")

    # Create folder structure
    folders = setup_project_structure(state.project_folder)

    # Copy CLAUDE.md to app_folder if it exists in reference files
    claude_md_source = Path(__file__).parent.parent.parent / "reference files" / "CLAUDE.md"
    claude_md_dest = state.project_folder / "app_folder" / "CLAUDE.md"

    if claude_md_source.exists():
        import shutil
        shutil.copy2(claude_md_source, claude_md_dest)

    # Generate metadata now that folders exist
    generate_metadata(state.project_folder)

    return {
        "success": True,
        "folders": {k: str(v) for k, v in folders.items()},
        "claude_md_copied": claude_md_source.exists()
    }


@app.get("/api/scripts")
async def list_scripts():
    """List available scripts"""
    if not state.project_folder:
        raise HTTPException(status_code=400, detail="No project folder selected")

    scripts_folder = state.project_folder / "app_folder" / "scripts"
    scripts = discover_scripts(scripts_folder)

    return {
        "scripts": [
            {
                "path": str(s),
                "relative_path": str(s.relative_to(scripts_folder)),
                "name": s.name
            }
            for s in scripts
        ]
    }


@app.post("/api/scripts/run")
async def run_scripts(request: RunScriptsRequest):
    """Run selected scripts"""
    import asyncio

    if not state.project_folder:
        raise HTTPException(status_code=400, detail="No project folder selected")

    results: list[ScriptResultResponse] = []

    for script_path in request.scripts:
        # Run in thread pool so server stays responsive (allows stop requests)
        result = await asyncio.to_thread(run_script, Path(script_path), state.project_folder)
        results.append(ScriptResultResponse(
            script_path=result.script_path,
            success=result.success,
            stdout=result.stdout,
            stderr=result.stderr,
            return_code=result.return_code,
            error=result.error,
            timed_out=result.timed_out,
            streamlit_url=result.streamlit_url
        ))

    # Regenerate metadata after running scripts
    generate_metadata(state.project_folder)

    return {"results": [r.model_dump() for r in results]}


@app.post("/api/scripts/stop")
async def stop_scripts():
    """Stop all currently running scripts"""
    stopped = stop_all_scripts()
    print(f"[Scripts] Stopped {stopped} running script(s)")
    return {"success": True, "stopped": stopped}


@app.get("/api/processes")
async def get_running_processes():
    """List all currently running script processes"""
    processes = list_running_processes()
    return {"processes": processes}


class StopProcessRequest(BaseModel):
    pid: int


@app.post("/api/processes/stop")
async def stop_single_process(request: StopProcessRequest):
    """Stop a specific process by PID"""
    success = stop_process(request.pid)
    if success:
        print(f"[Processes] Stopped process {request.pid}")
        return {"success": True, "pid": request.pid}
    else:
        return {"success": False, "error": f"Process {request.pid} not found or could not be stopped"}


@app.post("/api/metadata/generate")
async def regenerate_metadata():
    """Force metadata regeneration"""
    if not state.project_folder:
        raise HTTPException(status_code=400, detail="No project folder selected")

    input_meta, output_meta = generate_metadata(state.project_folder)

    return {
        "success": True,
        "input_metadata": input_meta,
        "output_metadata": output_meta
    }


class PipInstallRequest(BaseModel):
    package: str


@app.post("/api/pip/install")
async def pip_install(request: PipInstallRequest):
    """Install a Python package using pip"""
    import subprocess
    import sys

    # Sanitize package name - only allow alphanumeric, hyphens, underscores, brackets
    package = request.package.strip()
    if not package or not all(c.isalnum() or c in '-_[],' for c in package):
        raise HTTPException(status_code=400, detail="Invalid package name")

    try:
        # Run pip install
        result = subprocess.run(
            [sys.executable, "-m", "pip", "install", package],
            capture_output=True,
            text=True,
            timeout=120  # 2 minute timeout
        )

        return {
            "success": result.returncode == 0,
            "package": package,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "return_code": result.returncode
        }
    except subprocess.TimeoutExpired:
        return {
            "success": False,
            "package": package,
            "stdout": "",
            "stderr": "Installation timed out",
            "return_code": -1
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to install package: {str(e)}")


@app.get("/api/watch/check")
async def check_for_changes():
    """Manually check for file changes"""
    if not state.watcher:
        return {"changes": False}

    input_changes, output_changes, script_changes = state.watcher.check_once()

    has_changes = bool(input_changes or output_changes or script_changes)

    if input_changes or output_changes:
        generate_metadata(state.project_folder)

    return {
        "changes": has_changes,
        "input_changes": [{"path": c.path, "type": c.change_type} for c in input_changes],
        "output_changes": [{"path": c.path, "type": c.change_type} for c in output_changes],
        "script_changes": [{"path": c.path, "type": c.change_type} for c in script_changes]
    }


# Filesystem browsing endpoints

@app.get("/api/fs/home")
async def get_home_directory():
    """Get user's home directory"""
    return {"path": str(Path.home())}


@app.get("/api/fs/list")
async def list_directory(path: str = ""):
    """List directories at a given path (for folder picker)"""
    if not path:
        path = str(Path.home())

    target = Path(path)

    if not target.exists():
        raise HTTPException(status_code=404, detail="Path does not exist")

    if not target.is_dir():
        raise HTTPException(status_code=400, detail="Path is not a directory")

    folders = []
    try:
        for item in sorted(target.iterdir()):
            # Only show directories, skip hidden files
            if item.is_dir() and not item.name.startswith('.'):
                folders.append({
                    "name": item.name,
                    "path": str(item)
                })
    except PermissionError:
        raise HTTPException(status_code=403, detail="Permission denied")

    return {
        "current": str(target),
        "parent": str(target.parent) if target.parent != target else None,
        "folders": folders
    }


class MkdirRequest(BaseModel):
    path: str
    name: str


@app.post("/api/fs/mkdir")
async def create_directory(request: MkdirRequest):
    """Create a new directory"""
    parent = Path(request.path)

    # If path is relative, make it relative to project folder
    if not parent.is_absolute() and state.project_folder:
        parent = state.project_folder / request.path

    if not parent.exists():
        raise HTTPException(status_code=404, detail=f"Parent path does not exist: {parent}")

    if not parent.is_dir():
        raise HTTPException(status_code=400, detail=f"Parent path is not a directory: {parent}")

    # Sanitize folder name - no path traversal
    name = request.name.strip()
    if not name or '/' in name or '\\' in name or name.startswith('.'):
        raise HTTPException(status_code=400, detail="Invalid folder name")

    new_folder = parent / name

    if new_folder.exists():
        raise HTTPException(status_code=409, detail=f"Folder already exists: {new_folder}")

    try:
        new_folder.mkdir(parents=False, exist_ok=False)
        return {"success": True, "path": str(new_folder)}
    except PermissionError:
        raise HTTPException(status_code=403, detail="Permission denied")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create folder: {str(e)}")


# Extensions forbidden in app_folder (raw data files)
FORBIDDEN_APP_FOLDER_EXTENSIONS = {
    '.csv', '.xlsx', '.xls', '.xlsm', '.xlsb',  # Spreadsheets
    '.pdf',  # PDFs
    '.doc', '.docx',  # Word docs
    '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp',  # Images
    '.json',  # JSON data
    '.ppt', '.pptx',  # PowerPoint
}


def build_file_tree(path: Path, base_path: Path, deleted_files: list = None, in_app_folder: bool = False) -> dict:
    """Build a file tree recursively, auto-deleting forbidden files in app_folder"""
    if deleted_files is None:
        deleted_files = []

    rel_path = str(path.relative_to(base_path))
    is_file = path.is_file()
    node = {
        "name": path.name,
        "path": rel_path if rel_path != "." else path.name,
        "isDirectory": not is_file,
        "extension": path.suffix if is_file else None,
        "lastModified": path.stat().st_mtime if is_file else None,
    }

    if path.is_dir():
        children = []
        # Check if we're entering app_folder
        entering_app_folder = in_app_folder or path.name == "app_folder"
        try:
            for item in sorted(path.iterdir()):
                # Skip hidden files
                if item.name.startswith('.'):
                    continue

                # Auto-delete forbidden files in app_folder
                if entering_app_folder and item.is_file():
                    ext = item.suffix.lower()
                    if ext in FORBIDDEN_APP_FOLDER_EXTENSIONS:
                        try:
                            item.unlink()
                            deleted_files.append(item.name)
                            print(f"[Safety] Auto-deleted forbidden file: {item.name}")
                        except Exception as e:
                            print(f"[Safety] Failed to delete {item.name}: {e}")
                        continue  # Don't add to tree

                children.append(build_file_tree(item, base_path, deleted_files, entering_app_folder))
        except PermissionError:
            pass
        node["children"] = children

    return node


@app.get("/api/files/tree")
async def get_file_tree():
    """Get the complete file tree for the project"""
    if not state.project_folder:
        raise HTTPException(status_code=400, detail="No project folder selected")

    deleted_files = []
    tree = build_file_tree(state.project_folder, state.project_folder, deleted_files)
    return {"tree": tree, "deletedFiles": deleted_files}


@app.get("/api/files/read")
async def read_file(path: str):
    """Read a file's content - streams from disk, doesn't hold data in memory"""
    if not state.project_folder:
        raise HTTPException(status_code=400, detail="No project folder selected")

    # Clear any previous DataFrame state
    if df_state.file_path is not None:
        df_state.clear()

    file_path = state.project_folder / path
    print(f"[File Read] Loading: {path}")

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    if not file_path.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")

    # Security check - ensure path is within project folder
    try:
        file_path.resolve().relative_to(state.project_folder.resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail="Access denied")

    # Determine file type and read accordingly
    ext = file_path.suffix.lower()
    binary_extensions = {'.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.pdf', '.zip', '.tar', '.gz'}
    dataframe_extensions = {'.csv', '.xlsx', '.xls'}

    if ext in dataframe_extensions:
        print(f"[File Read] Parsing dataframe: {path}")
        # Parse as dataframe using Polars (much faster than pandas)
        try:
            if ext == '.csv':
                # Read raw bytes to detect line endings and separator
                with open(file_path, 'rb') as f:
                    sample = f.read(4096)

                # Detect line ending style
                has_crlf = b'\r\n' in sample
                has_lf = b'\n' in sample
                has_cr = b'\r' in sample

                # Detect separator from first line
                if has_crlf:
                    first_line = sample.split(b'\r\n')[0].decode('utf-8', errors='ignore')
                elif has_lf:
                    first_line = sample.split(b'\n')[0].decode('utf-8', errors='ignore')
                elif has_cr:
                    first_line = sample.split(b'\r')[0].decode('utf-8', errors='ignore')
                else:
                    first_line = sample.decode('utf-8', errors='ignore')

                # Detect separator
                if '\t' in first_line:
                    separator = '\t'
                elif ';' in first_line:
                    separator = ';'
                else:
                    separator = ','

                # Handle old Mac CR-only line endings - need temp file for streaming
                needs_cr_conversion = has_cr and not has_lf and not has_crlf
                actual_file_path = file_path
                temp_file = None

                if needs_cr_conversion:
                    # Convert CR to LF and write to temp file for streaming
                    import tempfile
                    with open(file_path, 'rb') as f:
                        content = f.read()
                    content = content.replace(b'\r', b'\n')
                    temp_file = tempfile.NamedTemporaryFile(mode='wb', suffix='.csv', delete=False)
                    temp_file.write(content)
                    temp_file.close()
                    actual_file_path = Path(temp_file.name)
                    del content  # Free memory

                # Store CSV file info for streaming
                df_state.clear()
                df_state.file_path = str(actual_file_path)
                df_state.csv_separator = separator
                df_state.file_type = 'csv'

                # Get schema and row count efficiently using streaming
                lf = pl.scan_csv(actual_file_path, separator=separator, infer_schema_length=10000)
                df_state.columns = lf.collect_schema().names()
                schema = lf.collect_schema()
                # Count rows (streams through file but doesn't hold in memory)
                df_state.total_rows = lf.select(pl.len()).collect().item()

            else:
                # Excel - need to read (but usually smaller files)
                df_state.clear()
                df_state.file_path = str(file_path)
                df_state.file_type = 'excel'
                df_state.csv_separator = ','
                # Just get schema info, don't hold the data
                temp_df = pl.read_excel(file_path)
                df_state.columns = temp_df.columns
                schema = temp_df.schema
                df_state.total_rows = len(temp_df)
                del temp_df
                lf = pl.read_excel(file_path).lazy()

            # Just store schema types - defer detailed column info until user filters
            # This avoids scanning the entire file multiple times on load
            column_info = {}
            for col in df_state.columns:
                dtype = schema.get(col)
                if dtype is None:
                    continue
                if dtype.is_numeric():
                    column_info[col] = {"type": "numeric", "min": 0, "max": 0}
                else:
                    column_info[col] = {"type": "categorical", "values": []}

            df_state.column_info = column_info

            # Get first chunk using streaming
            CHUNK_SIZE = 200
            first_chunk, total_rows = df_state.get_rows(0, CHUNK_SIZE)

            print(f"[File Read] Streaming mode: {df_state.total_rows} rows, only loaded {len(first_chunk)}")

            return {
                "type": "dataframe",
                "filePath": path,
                "columns": df_state.columns,
                "columnInfo": column_info,
                "data": first_chunk,
                "totalRows": df_state.total_rows,
                "offset": 0,
                "limit": CHUNK_SIZE,
                "filename": file_path.name
            }
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to parse file: {str(e)}")

    elif ext in binary_extensions:
        # Images - return metadata only, frontend uses /api/image endpoint for fast direct loading
        image_extensions = {'.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp'}
        if ext in image_extensions:
            return {"type": "image", "path": path, "filename": file_path.name, "extension": ext}
        # Other binary files - still use base64
        import base64
        content = base64.b64encode(file_path.read_bytes()).decode('utf-8')
        return {"content": content, "encoding": "base64", "filename": file_path.name}
    else:
        try:
            content = file_path.read_text(encoding='utf-8')
            return {"content": content, "encoding": "utf-8", "filename": file_path.name}
        except UnicodeDecodeError:
            import base64
            content = base64.b64encode(file_path.read_bytes()).decode('utf-8')
            return {"content": content, "encoding": "base64", "filename": file_path.name}


@app.get("/api/image")
async def get_image(path: str):
    """Serve image files directly as binary for fast loading"""
    if not state.project_folder:
        raise HTTPException(status_code=400, detail="No project folder selected")

    file_path = state.project_folder / path

    # Security check
    try:
        file_path.resolve().relative_to(state.project_folder.resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail="Access denied")

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Image not found")

    # Map extensions to media types
    ext = file_path.suffix.lower()
    media_types = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.bmp': 'image/bmp',
        '.ico': 'image/x-icon',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
    }

    media_type = media_types.get(ext, 'application/octet-stream')
    return FileResponse(file_path, media_type=media_type)


class WriteFileRequest(BaseModel):
    path: str
    content: str


@app.post("/api/files/write")
async def write_file(request: WriteFileRequest):
    """Write content to a file"""
    if not state.project_folder:
        raise HTTPException(status_code=400, detail="No project folder selected")

    file_path = state.project_folder / request.path

    # Security check - ensure path is within project folder
    try:
        file_path.resolve().relative_to(state.project_folder.resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail="Access denied")

    # Create parent directories if needed
    file_path.parent.mkdir(parents=True, exist_ok=True)

    file_path.write_text(request.content, encoding='utf-8')

    return {"success": True, "path": request.path}


@app.post("/api/files/upload")
async def upload_file(
    file: UploadFile = File(...),
    folder: str = Form(...)
):
    """Upload a binary file to a folder"""
    if not state.project_folder:
        raise HTTPException(status_code=400, detail="No project folder selected")

    # Build target path
    target_folder = state.project_folder / folder
    target_path = target_folder / file.filename

    # Security check - ensure path is within project folder
    try:
        target_path.resolve().relative_to(state.project_folder.resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail="Access denied")

    # Create parent directories if needed
    target_folder.mkdir(parents=True, exist_ok=True)

    # Write file content
    content = await file.read()
    target_path.write_bytes(content)

    return {"success": True, "path": f"{folder}/{file.filename}"}


class DeleteFileRequest(BaseModel):
    path: str
    isDirectory: bool = False


@app.post("/api/files/delete")
async def delete_file(request: DeleteFileRequest):
    """Delete a file or directory"""
    if not state.project_folder:
        raise HTTPException(status_code=400, detail="No project folder selected")

    file_path = state.project_folder / request.path

    # Security check - ensure path is within project folder
    try:
        file_path.resolve().relative_to(state.project_folder.resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail="Access denied")

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    import shutil
    if request.isDirectory:
        shutil.rmtree(file_path)
    else:
        file_path.unlink()

    return {"success": True, "path": request.path}


class RenameRequest(BaseModel):
    oldPath: str
    newName: str


@app.post("/api/files/rename")
async def rename_file(request: RenameRequest):
    """Rename a file or directory"""
    if not state.project_folder:
        raise HTTPException(status_code=400, detail="No project folder selected")

    old_path = Path(request.oldPath)
    if not old_path.is_absolute():
        old_path = state.project_folder / request.oldPath

    # Security check
    try:
        old_path.resolve().relative_to(state.project_folder.resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail="Access denied")

    if not old_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    new_path = old_path.parent / request.newName

    # Check if new path already exists
    if new_path.exists():
        raise HTTPException(status_code=400, detail="A file with that name already exists")

    import shutil
    shutil.move(str(old_path), str(new_path))

    return {"success": True, "oldPath": str(old_path), "newPath": str(new_path)}


class MoveRequest(BaseModel):
    sourcePath: str
    destPath: str


@app.post("/api/files/move")
async def move_file(request: MoveRequest):
    """Move a file or directory"""
    if not state.project_folder:
        raise HTTPException(status_code=400, detail="No project folder selected")

    source_path = Path(request.sourcePath)
    dest_path = Path(request.destPath)

    if not source_path.is_absolute():
        source_path = state.project_folder / request.sourcePath
    if not dest_path.is_absolute():
        dest_path = state.project_folder / request.destPath

    # Security check
    try:
        source_path.resolve().relative_to(state.project_folder.resolve())
        dest_path.resolve().relative_to(state.project_folder.resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail="Access denied")

    if not source_path.exists():
        raise HTTPException(status_code=404, detail="Source file not found")

    # Ensure destination directory exists
    dest_path.parent.mkdir(parents=True, exist_ok=True)

    import shutil
    shutil.move(str(source_path), str(dest_path))

    return {"success": True, "sourcePath": str(source_path), "destPath": str(dest_path)}


# DataFrame streaming endpoints

class DataFrameQueryRequest(BaseModel):
    filePath: str
    filters: dict = {}
    sort: Optional[dict] = None  # {column: str, direction: "asc"|"desc"}


@app.get("/api/dataframe/rows")
async def get_dataframe_rows(
    filePath: str,
    offset: int = 0,
    limit: int = 200
):
    """Get paginated rows - streams from disk, doesn't hold full file in memory"""
    if df_state.file_path is None:
        raise HTTPException(status_code=400, detail="No DataFrame loaded. Read a file first.")

    # Stream rows from disk
    rows, total_rows = df_state.get_rows(offset, limit)

    return {
        "data": rows,
        "offset": offset,
        "limit": limit,
        "totalRows": total_rows
    }


@app.post("/api/dataframe/query")
async def query_dataframe(request: DataFrameQueryRequest):
    """Apply filters and/or sort to the DataFrame - streams from disk"""
    if df_state.file_path is None or df_state.file_path != request.filePath:
        raise HTTPException(status_code=400, detail="DataFrame not loaded. Read the file first.")

    # Update filters and sort on state
    df_state.current_filters = request.filters
    df_state.current_sort = request.sort
    df_state.invalidate_filter_cache()  # Force recount

    # Get first chunk using streaming
    CHUNK_SIZE = 200
    rows, total_rows = df_state.get_rows(0, CHUNK_SIZE)

    # Compute cascading columnInfo from filtered data
    # For efficiency, we sample a limited number of rows for column stats
    cascading_column_info = await _compute_cascading_column_info()

    return {
        "data": rows,
        "totalRows": total_rows,
        "offset": 0,
        "limit": CHUNK_SIZE,
        "appliedFilters": request.filters,
        "appliedSort": request.sort,
        "columnInfo": cascading_column_info
    }


async def _compute_cascading_column_info() -> dict:
    """Compute column info (min/max for numeric, unique values for categorical) from filtered data.
    Uses lazy evaluation for efficiency."""
    if df_state.file_path is None:
        return {}

    lf = df_state._get_lazy_frame()
    if lf is None:
        return {}

    lf = df_state._apply_filters_sort(lf)

    # Collect schema to determine column types
    schema = lf.collect_schema()
    cascading_column_info = {}

    for col in df_state.columns:
        dtype = schema.get(col)
        if dtype is None:
            continue

        try:
            if dtype.is_numeric():
                # Get min/max in one query
                stats = lf.select([
                    pl.col(col).min().alias('min'),
                    pl.col(col).max().alias('max')
                ]).collect()
                min_val = stats['min'][0]
                max_val = stats['max'][0]
                cascading_column_info[col] = {
                    "type": "numeric",
                    "min": float(min_val) if min_val is not None else 0,
                    "max": float(max_val) if max_val is not None else 0
                }
            else:
                # Categorical - get unique values (limit to 500)
                unique_vals = lf.select(
                    pl.col(col).drop_nulls().unique().head(500)
                ).collect()[col].to_list()
                unique_vals = [str(v) for v in unique_vals if v != '']
                cascading_column_info[col] = {
                    "type": "categorical",
                    "values": unique_vals
                }
        except Exception:
            # If any error, use cached column info
            if col in df_state.column_info:
                cascading_column_info[col] = df_state.column_info[col]

    return cascading_column_info


@app.post("/api/dataframe/clear")
async def clear_dataframe():
    """Clear the DataFrame from memory"""
    df_state.clear()
    return {"success": True}


# Codespace sync endpoints

FORBIDDEN_SYNC_EXTENSIONS = {'.pdf', '.csv', '.xlsx', '.xls', '.xlsm', '.xlsb', '.ppt', '.pptx'}
PROTECTED_FILES = {'sync_server.py', 'metadatafarmer.py', 'CLAUDE.md'}
PROTECTED_DIRS = {'meta_data'}


class SyncPullRequest(BaseModel):
    codespace_url: str
    last_sync: dict = {}


class SyncPushRequest(BaseModel):
    codespace_url: str


@app.post("/api/sync/pull")
async def sync_pull_scripts(request: SyncPullRequest):
    """Pull scripts from codespace and save locally"""
    if not state.project_folder:
        raise HTTPException(status_code=400, detail="No project folder selected")

    synced_files = []
    new_last_sync = dict(request.last_sync)

    async with httpx.AsyncClient(timeout=30.0) as client:
        # Get scripts list from codespace
        try:
            response = await client.get(f"{request.codespace_url}/scripts")
            response.raise_for_status()
            scripts = response.json().get("scripts", [])
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Failed to fetch scripts: {str(e)}")

        # Get or create local app_folder/scripts
        app_folder = state.project_folder / "app_folder"
        app_folder.mkdir(parents=True, exist_ok=True)

        for script in scripts:
            file_path = script.get("path") or script.get("name")
            server_mod = int(script.get("modified", 0))
            local_mod = int(request.last_sync.get(file_path, 0))

            # Download if new or modified
            if local_mod < server_mod:
                try:
                    script_response = await client.get(
                        f"{request.codespace_url}/scripts/{file_path}"
                    )
                    script_response.raise_for_status()
                    script_data = script_response.json()

                    # Write to local file
                    local_path = app_folder / file_path
                    local_path.parent.mkdir(parents=True, exist_ok=True)
                    local_path.write_text(script_data.get("content", ""), encoding="utf-8")

                    new_last_sync[file_path] = server_mod
                    synced_files.append(file_path)
                except Exception as e:
                    print(f"Failed to sync {file_path}: {e}")
            else:
                new_last_sync[file_path] = local_mod

    return {"synced_files": synced_files, "last_sync": new_last_sync}


@app.post("/api/sync/push")
async def sync_push_scripts(request: SyncPushRequest):
    """Push local scripts to codespace"""
    if not state.project_folder:
        raise HTTPException(status_code=400, detail="No project folder selected")

    pushed_files = []
    app_folder = state.project_folder / "app_folder"

    if not app_folder.exists():
        return {"pushed_files": []}

    def collect_files(folder: Path, prefix: str = "") -> list:
        """Recursively collect files to push"""
        files = []
        try:
            for item in folder.iterdir():
                if item.name.startswith('.'):
                    continue
                if item.is_dir():
                    if item.name not in PROTECTED_DIRS and item.name != "node_modules":
                        sub_prefix = f"{prefix}/{item.name}" if prefix else item.name
                        files.extend(collect_files(item, sub_prefix))
                else:
                    if item.name in PROTECTED_FILES:
                        continue
                    ext = item.suffix.lower()
                    if ext in FORBIDDEN_SYNC_EXTENSIONS:
                        continue
                    rel_path = f"{prefix}/{item.name}" if prefix else item.name
                    try:
                        content = item.read_text(encoding="utf-8")
                        files.append({"path": rel_path, "content": content})
                    except Exception:
                        pass
        except PermissionError:
            pass
        return files

    files_to_push = collect_files(app_folder)

    async with httpx.AsyncClient(timeout=30.0) as client:
        for file in files_to_push:
            try:
                response = await client.post(
                    f"{request.codespace_url}/scripts/{file['path']}",
                    json={"content": file["content"]}
                )
                response.raise_for_status()
                pushed_files.append(file["path"])
            except Exception as e:
                print(f"Failed to push {file['path']}: {e}")

    return {"pushed_files": pushed_files}


@app.post("/api/sync/metadata")
async def sync_metadata_to_codespace(request: SyncPushRequest):
    """Push local metadata to codespace"""
    if not state.project_folder:
        raise HTTPException(status_code=400, detail="No project folder selected")

    meta_folder = state.project_folder / "app_folder" / "meta_data"

    input_metadata = ""
    output_metadata = ""

    input_file = meta_folder / "input_metadata.txt"
    output_file = meta_folder / "output_metadata.txt"

    if input_file.exists():
        input_metadata = input_file.read_text(encoding="utf-8")
    if output_file.exists():
        output_metadata = output_file.read_text(encoding="utf-8")

    if not input_metadata and not output_metadata:
        return {"success": True, "synced": False}

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            response = await client.post(
                f"{request.codespace_url}/metadata",
                json={
                    "input_metadata": input_metadata,
                    "output_metadata": output_metadata
                }
            )
            response.raise_for_status()
            return {"success": True, "synced": True}
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Failed to sync metadata: {str(e)}")


@app.post("/api/sync/full")
async def sync_full(request: SyncPullRequest):
    """Full bidirectional sync: pull scripts, push metadata"""
    if not state.project_folder:
        raise HTTPException(status_code=400, detail="No project folder selected")

    # Pull scripts
    pull_result = await sync_pull_scripts(request)

    # Push metadata
    push_request = SyncPushRequest(codespace_url=request.codespace_url)
    try:
        metadata_result = await sync_metadata_to_codespace(push_request)
        metadata_synced = metadata_result.get("synced", False)
    except Exception:
        metadata_synced = False

    return {
        "scripts_sync": {
            "synced_files": pull_result["synced_files"],
            "last_sync": pull_result["last_sync"]
        },
        "metadata_sync": metadata_synced
    }


# GitHub OAuth endpoints (Device Flow - no client secret needed)

class DeviceCodeRequest(BaseModel):
    client_id: str
    scope: str = ""


class TokenPollRequest(BaseModel):
    client_id: str
    device_code: str
    grant_type: str = "urn:ietf:params:oauth:grant-type:device_code"


@app.post("/api/github/device-code")
async def github_device_code(request: DeviceCodeRequest):
    """Initiate GitHub device flow authentication"""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                "https://github.com/login/device/code",
                data={
                    "client_id": request.client_id,
                    "scope": request.scope,
                },
                headers={"Accept": "application/json"},
            )

            if not response.content:
                return JSONResponse(status_code=502, content={"error": "Empty response from GitHub"})

            try:
                data = response.json()
            except Exception:
                return JSONResponse(status_code=502, content={"error": f"Invalid response from GitHub"})

            return JSONResponse(status_code=response.status_code, content=data)
    except httpx.TimeoutException:
        return JSONResponse(status_code=504, content={"error": "GitHub request timed out"})
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": f"Failed to connect to GitHub: {str(e)}"})


@app.post("/api/github/token")
async def github_token(request: TokenPollRequest):
    """Poll for GitHub access token"""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                "https://github.com/login/oauth/access_token",
                data={
                    "client_id": request.client_id,
                    "device_code": request.device_code,
                    "grant_type": request.grant_type,
                },
                headers={"Accept": "application/json"},
            )

            if not response.content:
                return JSONResponse(status_code=502, content={"error": "Empty response from GitHub"})

            try:
                data = response.json()
            except Exception:
                return JSONResponse(status_code=502, content={"error": "Invalid response from GitHub"})

            return JSONResponse(status_code=200, content=data)
    except httpx.TimeoutException:
        return JSONResponse(status_code=504, content={"error": "GitHub request timed out"})
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": f"Failed to connect to GitHub: {str(e)}"})


# WebSocket for real-time updates

@app.websocket("/ws/watch")
async def websocket_watch(websocket: WebSocket):
    """WebSocket for file change notifications"""
    await websocket.accept()
    state.websocket_clients.append(websocket)

    try:
        while True:
            # Keep connection alive, wait for messages
            try:
                data = await asyncio.wait_for(websocket.receive_text(), timeout=30)
                # Handle any incoming messages (e.g., ping)
                if data == "ping":
                    await websocket.send_text("pong")
            except asyncio.TimeoutError:
                # Send keepalive
                await websocket.send_text('{"type": "keepalive"}')
    except WebSocketDisconnect:
        state.websocket_clients.remove(websocket)
    except Exception:
        if websocket in state.websocket_clients:
            state.websocket_clients.remove(websocket)


async def notify_data_change():
    """Notify all WebSocket clients of data change"""
    if state.project_folder:
        generate_metadata(state.project_folder)

    message = '{"type": "data_change"}'
    disconnected = []

    for client in state.websocket_clients:
        try:
            await client.send_text(message)
        except Exception:
            disconnected.append(client)

    for client in disconnected:
        state.websocket_clients.remove(client)


async def notify_script_change(script_path: Path):
    """Notify all WebSocket clients of script change"""
    # Send full absolute path (same format as /api/scripts endpoint)
    full_path = str(script_path)
    # Use forward slashes for consistency on Windows
    full_path = full_path.replace("\\", "/")

    # Debounce: skip if we notified about this script in the last 3 seconds
    # Use lowercase key for case-insensitive matching (Windows paths)
    debounce_key = full_path.lower()
    now = time.time()
    if debounce_key in state.last_script_change:
        if now - state.last_script_change[debounce_key] < 3.0:
            print(f"[Script Change] Debounced (duplicate within 3s): {full_path}")
            return
    state.last_script_change[debounce_key] = now
    # Clean up old entries
    state.last_script_change = {k: v for k, v in state.last_script_change.items() if now - v < 10.0}

    print(f"[Script Change] Notifying {len(state.websocket_clients)} clients: {full_path}")
    message = json.dumps({"type": "script_change", "path": full_path})
    disconnected = []

    for client in state.websocket_clients:
        try:
            await client.send_text(message)
        except Exception:
            disconnected.append(client)

    for client in disconnected:
        state.websocket_clients.remove(client)


async def notify_output_file_change(file_path: Path, change_type: str):
    """Notify all WebSocket clients of output file change for auto-preview"""
    # Get relative path from project folder
    rel_path = str(file_path)
    if state.project_folder:
        try:
            rel_path = str(file_path.relative_to(state.project_folder))
        except ValueError:
            pass
    # Use forward slashes for consistency (Windows fix)
    rel_path = rel_path.replace("\\", "/")

    print(f"[Output Change] Notifying {len(state.websocket_clients)} clients: {rel_path}")
    message = json.dumps({"type": "output_file_change", "path": rel_path, "change_type": change_type})
    disconnected = []

    for client in state.websocket_clients:
        try:
            await client.send_text(message)
        except Exception:
            disconnected.append(client)

    for client in disconnected:
        state.websocket_clients.remove(client)


# Local Terminal WebSocket

def set_terminal_size(fd, rows, cols):
    """Set terminal window size"""
    if sys.platform == 'win32':
        return  # Not supported on Windows
    winsize = struct.pack("HHHH", rows, cols, 0, 0)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)


@app.websocket("/ws/terminal")
async def websocket_terminal(websocket: WebSocket):
    """WebSocket for local terminal"""
    await websocket.accept()

    # Terminal not supported on Windows
    if sys.platform == 'win32':
        await websocket.send_text("Terminal not supported on Windows.\r\n")
        await websocket.close()
        return

    # Fork a PTY
    pid, fd = pty.fork()

    if pid == 0:
        # Child process - create new session/process group so we can kill all children
        os.setsid()
        cwd = str(state.project_folder) if state.project_folder else str(Path.home())
        os.chdir(cwd)
        os.environ["TERM"] = "xterm-256color"
        os.execvp("bash", ["bash", "-l"])
    else:
        # Parent process - relay data
        print(f"[Terminal] Started PTY process {pid}")
        set_terminal_size(fd, 24, 80)

        # Make fd non-blocking
        flags = fcntl.fcntl(fd, fcntl.F_GETFL)
        fcntl.fcntl(fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)

        try:
            while True:
                # Check for data from terminal (non-blocking)
                r, _, _ = select.select([fd], [], [], 0.05)
                if fd in r:
                    try:
                        data = os.read(fd, 8192)
                        if data:
                            await websocket.send_text(data.decode("utf-8", errors="replace"))
                    except OSError:
                        break

                # Check for data from websocket (with timeout)
                try:
                    data = await asyncio.wait_for(websocket.receive_text(), timeout=0.05)
                    if data:
                        # Check for JSON commands
                        if data.startswith('{'):
                            try:
                                msg = json.loads(data)
                                if msg.get('type') == 'resize':
                                    rows = msg.get('rows', 24)
                                    cols = msg.get('cols', 80)
                                    set_terminal_size(fd, rows, cols)
                                elif msg.get('type') == 'ping':
                                    await websocket.send_text('{"type":"pong"}')
                            except json.JSONDecodeError:
                                pass
                        else:
                            os.write(fd, data.encode("utf-8"))
                except asyncio.TimeoutError:
                    pass
                except WebSocketDisconnect:
                    print(f"[Terminal] WebSocket disconnected, cleaning up PTY {pid}")
                    break
        finally:
            # Clean up: close fd and kill the entire process group
            print(f"[Terminal] Cleaning up PTY process {pid}")
            try:
                os.close(fd)
            except OSError:
                pass

            # Kill the entire process group (bash + all child processes like claude)
            try:
                # First try SIGTERM to the process group
                os.killpg(pid, signal.SIGTERM)
            except OSError:
                # Process group might not exist, try killing just the pid
                try:
                    os.kill(pid, signal.SIGTERM)
                except OSError:
                    pass

            # Give processes a moment to terminate gracefully
            await asyncio.sleep(0.5)

            # Force kill if still running
            try:
                os.killpg(pid, signal.SIGKILL)
            except OSError:
                try:
                    os.kill(pid, signal.SIGKILL)
                except OSError:
                    pass

            # Reap zombie process
            try:
                os.waitpid(pid, os.WNOHANG)
            except OSError:
                pass

            print(f"[Terminal] PTY process {pid} cleaned up")


# Serve static files (React app)

@app.get("/")
async def serve_index():
    """Serve the React app index.html"""
    static_dir = get_static_dir()
    index_path = static_dir / "index.html"

    if not index_path.exists():
        return JSONResponse(
            status_code=503,
            content={
                "error": "Frontend not built",
                "message": "Run 'npm run build' in the frontend directory first"
            }
        )

    return FileResponse(index_path)


# Mount static files for assets (at module load time)
_static_dir = get_static_dir()
_assets_dir = _static_dir / "assets"
if _assets_dir.exists():
    app.mount("/assets", StaticFiles(directory=_assets_dir), name="assets")


def create_app() -> FastAPI:
    """Factory function for creating the app"""
    return app
