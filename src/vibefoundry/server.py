"""
FastAPI backend server for VibeFoundry IDE
"""

import os
import sys
import json
import asyncio
import struct
import signal
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
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from vibefoundry.runner import discover_scripts, run_script, setup_project_structure, ScriptResult
from vibefoundry.metadata import generate_metadata
from vibefoundry.watcher import FileWatcher


# Global state
class AppState:
    project_folder: Optional[Path] = None
    watcher: Optional[FileWatcher] = None
    websocket_clients: list[WebSocket] = []


class DataFrameState:
    """Holds the currently viewed DataFrame in memory (using Polars for speed)"""
    def __init__(self):
        self.df: Optional[pl.DataFrame] = None  # Polars DataFrame
        self.file_path: Optional[str] = None
        self.column_info: dict = {}  # {col: {type, min, max, values}}
        self.current_filters: dict = {}
        self.current_sort: Optional[tuple] = None  # (column, direction)
        self._filtered_df: Optional[pl.DataFrame] = None  # Cached filtered/sorted DataFrame

    def clear(self):
        """Clear the DataFrame from memory"""
        self.df = None
        self.file_path = None
        self.column_info = {}
        self.current_filters = {}
        self.current_sort = None
        self._filtered_df = None

    def get_processed_df(self) -> Optional[pl.DataFrame]:
        """Get the filtered/sorted DataFrame, using cache if available"""
        if self.df is None:
            return None
        if self._filtered_df is not None:
            return self._filtered_df
        return self.df

    def invalidate_cache(self):
        """Invalidate the filtered/sorted cache"""
        self._filtered_df = None


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


@app.post("/api/folder/select")
async def select_folder(request: FolderSelectRequest):
    """Set the project folder and initialize structure"""
    folder_path = Path(request.path)

    if not folder_path.exists():
        raise HTTPException(status_code=400, detail="Folder does not exist")

    if not folder_path.is_dir():
        raise HTTPException(status_code=400, detail="Path is not a directory")

    state.project_folder = folder_path

    # Setup folder structure
    folders = setup_project_structure(folder_path)

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
    if not state.project_folder:
        raise HTTPException(status_code=400, detail="No project folder selected")

    results: list[ScriptResultResponse] = []

    for script_path in request.scripts:
        result = run_script(Path(script_path), state.project_folder)
        results.append(ScriptResultResponse(
            script_path=result.script_path,
            success=result.success,
            stdout=result.stdout,
            stderr=result.stderr,
            return_code=result.return_code,
            error=result.error,
            timed_out=result.timed_out
        ))

    # Regenerate metadata after running scripts
    generate_metadata(state.project_folder)

    return {"results": [r.model_dump() for r in results]}


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


def build_file_tree(path: Path, base_path: Path) -> dict:
    """Build a file tree recursively"""
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
        try:
            for item in sorted(path.iterdir()):
                # Skip hidden files
                if item.name.startswith('.'):
                    continue
                children.append(build_file_tree(item, base_path))
        except PermissionError:
            pass
        node["children"] = children

    return node


@app.get("/api/files/tree")
async def get_file_tree():
    """Get the complete file tree for the project"""
    if not state.project_folder:
        raise HTTPException(status_code=400, detail="No project folder selected")

    tree = build_file_tree(state.project_folder, state.project_folder)
    return {"tree": tree}


@app.get("/api/files/read")
async def read_file(path: str):
    """Read a file's content"""
    import pandas as pd

    if not state.project_folder:
        raise HTTPException(status_code=400, detail="No project folder selected")

    file_path = state.project_folder / path

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

                # Handle old Mac CR-only line endings by converting to LF
                if has_cr and not has_lf and not has_crlf:
                    with open(file_path, 'rb') as f:
                        content = f.read()
                    content = content.replace(b'\r', b'\n')
                    import io
                    df = pl.read_csv(io.BytesIO(content), separator=separator, has_header=True, infer_schema_length=10000, truncate_ragged_lines=True)
                else:
                    df = pl.read_csv(file_path, separator=separator, has_header=True, infer_schema_length=10000, truncate_ragged_lines=True)
            else:
                # Polars reads Excel via xlsx2csv or calamine
                df = pl.read_excel(file_path)

            # Store in global state (clear previous)
            df_state.clear()
            df_state.df = df
            df_state.file_path = path

            # Compute column metadata using Polars
            column_info = {}
            for col in df.columns:
                dtype = df[col].dtype
                # Check if numeric
                if dtype.is_numeric():
                    col_data = df[col].drop_nulls()
                    if len(col_data) > 0:
                        column_info[col] = {
                            "type": "numeric",
                            "min": float(col_data.min()),
                            "max": float(col_data.max())
                        }
                    else:
                        column_info[col] = {"type": "numeric", "min": 0, "max": 0}
                else:
                    # Categorical - get unique values
                    unique_vals = df[col].drop_nulls().unique().head(500).to_list()
                    # Convert to strings for JSON serialization
                    unique_vals = [str(v) for v in unique_vals if v != '']
                    column_info[col] = {
                        "type": "categorical",
                        "values": unique_vals
                    }

            df_state.column_info = column_info

            # Return first 200 rows - convert nulls to empty string for JSON
            CHUNK_SIZE = 200
            columns = list(df_state.df.columns)
            # Use write_json for proper null handling, then parse back
            chunk_df = df_state.df.head(CHUNK_SIZE)
            first_chunk = chunk_df.to_dicts()
            # Replace None with empty string in the dicts
            for row in first_chunk:
                for key in row:
                    if row[key] is None:
                        row[key] = ''

            return {
                "type": "dataframe",
                "filePath": path,
                "columns": columns,
                "columnInfo": column_info,
                "data": first_chunk,
                "totalRows": df_state.df.height,
                "offset": 0,
                "limit": CHUNK_SIZE,
                "filename": file_path.name
            }
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to parse file: {str(e)}")

    elif ext in binary_extensions:
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
    """Get paginated rows from the cached DataFrame (using Polars)"""
    if df_state.df is None or df_state.file_path != filePath:
        raise HTTPException(status_code=400, detail="DataFrame not loaded. Read the file first.")

    # Get the processed (filtered/sorted) DataFrame
    df = df_state.get_processed_df()
    if df is None:
        raise HTTPException(status_code=400, detail="DataFrame not available")

    # Slice the requested rows using Polars
    chunk = df.slice(offset, limit).to_dicts()
    # Replace None with empty string for JSON
    for row in chunk:
        for key in row:
            if row[key] is None:
                row[key] = ''

    return {
        "data": chunk,
        "offset": offset,
        "limit": limit,
        "totalRows": df.height
    }


@app.post("/api/dataframe/query")
async def query_dataframe(request: DataFrameQueryRequest):
    """Apply filters and/or sort to the DataFrame using Polars (fast)"""
    if df_state.df is None or df_state.file_path != request.filePath:
        raise HTTPException(status_code=400, detail="DataFrame not loaded. Read the file first.")

    # Start with the original DataFrame
    df = df_state.df

    # Build filter expressions
    filter_exprs = []
    for column, filter_val in request.filters.items():
        if column not in df.columns:
            continue

        if isinstance(filter_val, dict):
            # Numeric range filter
            if filter_val.get('min') not in (None, '', 'null'):
                try:
                    min_val = float(filter_val['min'])
                    filter_exprs.append(pl.col(column).cast(pl.Float64, strict=False) >= min_val)
                except (ValueError, TypeError):
                    pass
            if filter_val.get('max') not in (None, '', 'null'):
                try:
                    max_val = float(filter_val['max'])
                    filter_exprs.append(pl.col(column).cast(pl.Float64, strict=False) <= max_val)
                except (ValueError, TypeError):
                    pass
        elif isinstance(filter_val, list) and len(filter_val) > 0:
            # Categorical filter - include rows matching any value
            str_vals = [str(v) for v in filter_val]
            filter_exprs.append(pl.col(column).cast(pl.Utf8).is_in(str_vals))

    # Apply all filters at once (more efficient)
    if filter_exprs:
        combined_filter = filter_exprs[0]
        for expr in filter_exprs[1:]:
            combined_filter = combined_filter & expr
        df = df.filter(combined_filter)

    # Apply sort
    if request.sort and request.sort.get('column'):
        sort_col = request.sort['column']
        descending = request.sort.get('direction', 'asc') != 'asc'
        if sort_col in df.columns:
            df = df.sort(sort_col, descending=descending, nulls_last=True)

    # Cache the processed DataFrame
    df_state._filtered_df = df
    df_state.current_filters = request.filters
    df_state.current_sort = request.sort

    # Return first chunk
    CHUNK_SIZE = 200
    first_chunk = df.head(CHUNK_SIZE).to_dicts()
    # Replace None with empty string for JSON
    for row in first_chunk:
        for key in row:
            if row[key] is None:
                row[key] = ''

    return {
        "data": first_chunk,
        "totalRows": df.height,
        "offset": 0,
        "limit": CHUNK_SIZE,
        "appliedFilters": request.filters,
        "appliedSort": request.sort
    }


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
    # Convert to relative path with forward slashes (works on all platforms)
    rel_path = script_path.name  # Just the filename
    if state.project_folder:
        try:
            rel_path = str(script_path.relative_to(state.project_folder / "app_folder" / "scripts"))
        except ValueError:
            rel_path = script_path.name
    # Use forward slashes for consistency
    rel_path = rel_path.replace("\\", "/")

    print(f"[Script Change] Notifying {len(state.websocket_clients)} clients: {rel_path}")
    message = json.dumps({"type": "script_change", "path": rel_path})
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
        # Child process - start bash
        cwd = str(state.project_folder) if state.project_folder else str(Path.home())
        os.chdir(cwd)
        os.environ["TERM"] = "xterm-256color"
        os.execvp("bash", ["bash", "-l"])
    else:
        # Parent process - relay data
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
                    break
        finally:
            os.close(fd)
            try:
                os.kill(pid, signal.SIGTERM)
                os.waitpid(pid, 0)
            except:
                pass


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
