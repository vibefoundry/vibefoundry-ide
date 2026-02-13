"""
Script discovery and execution
"""

import sys
import subprocess
import signal
import re
import time
import threading
from pathlib import Path
from dataclasses import dataclass
from typing import Optional

# Track running processes for stop functionality
running_processes: list[subprocess.Popen] = []
# Track Streamlit processes separately (they run in background)
streamlit_processes: dict[str, subprocess.Popen] = {}  # script_path -> process


@dataclass
class ScriptResult:
    """Result of running a script"""
    script_path: str
    success: bool
    stdout: str
    stderr: str
    return_code: int
    error: Optional[str] = None
    timed_out: bool = False
    streamlit_url: Optional[str] = None  # URL if this was a Streamlit app


def discover_scripts(scripts_folder: Path) -> list[Path]:
    """
    Find all Python scripts in the scripts folder.

    Args:
        scripts_folder: Path to app_folder/scripts/

    Returns:
        List of script paths sorted alphabetically
    """
    if not scripts_folder.exists():
        return []

    return sorted(scripts_folder.glob("**/*.py"))


def is_streamlit_script(script_path: Path) -> bool:
    """
    Check if a script is a Streamlit app by looking for streamlit imports.

    Args:
        script_path: Path to the script

    Returns:
        True if the script imports streamlit
    """
    try:
        content = script_path.read_text(encoding='utf-8')
        # Look for streamlit imports
        if re.search(r'^\s*import\s+streamlit', content, re.MULTILINE):
            return True
        if re.search(r'^\s*from\s+streamlit\s+import', content, re.MULTILINE):
            return True
        return False
    except Exception:
        return False


def run_streamlit_script(script_path: Path, project_folder: Path) -> ScriptResult:
    """
    Run a Streamlit script as a background process and capture the localhost URL.

    Args:
        script_path: Path to the Streamlit script
        project_folder: Working directory for execution

    Returns:
        ScriptResult with streamlit_url if successful
    """
    script_key = str(script_path)

    # Stop any existing Streamlit process for this script
    if script_key in streamlit_processes:
        old_process = streamlit_processes[script_key]
        try:
            old_process.terminate()
            old_process.wait(timeout=2)
        except Exception:
            try:
                old_process.kill()
            except Exception:
                pass
        del streamlit_processes[script_key]

    try:
        # Start Streamlit process
        process = subprocess.Popen(
            [sys.executable, "-m", "streamlit", "run", str(script_path),
             "--server.headless", "true"],
            cwd=str(project_folder),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,  # Combine stderr into stdout
            text=True,
            bufsize=1  # Line buffered
        )

        # Track the process
        streamlit_processes[script_key] = process
        running_processes.append(process)

        # Read output to find the URL (with timeout)
        url = None
        output_lines = []
        start_time = time.time()
        timeout = 30  # 30 seconds to find URL

        # Pattern to match Streamlit's local URL output
        url_pattern = re.compile(r'Local URL:\s*(http://localhost:\d+)')

        while time.time() - start_time < timeout:
            line = process.stdout.readline()
            if not line:
                # Check if process is still running
                if process.poll() is not None:
                    break
                continue

            output_lines.append(line.rstrip())

            # Look for the URL
            match = url_pattern.search(line)
            if match:
                url = match.group(1)
                break

        if url:
            # Start a background thread to consume remaining output
            def drain_output():
                try:
                    while True:
                        line = process.stdout.readline()
                        if not line and process.poll() is not None:
                            break
                except Exception:
                    pass

            drain_thread = threading.Thread(target=drain_output, daemon=True)
            drain_thread.start()

            return ScriptResult(
                script_path=str(script_path),
                success=True,
                stdout="\n".join(output_lines),
                stderr="",
                return_code=0,
                streamlit_url=url
            )
        else:
            # Failed to get URL - kill the process
            process.terminate()
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()

            if process in running_processes:
                running_processes.remove(process)
            if script_key in streamlit_processes:
                del streamlit_processes[script_key]

            return ScriptResult(
                script_path=str(script_path),
                success=False,
                stdout="\n".join(output_lines),
                stderr="",
                return_code=-1,
                error="Failed to start Streamlit app - could not detect localhost URL"
            )

    except Exception as e:
        if script_key in streamlit_processes:
            del streamlit_processes[script_key]
        return ScriptResult(
            script_path=str(script_path),
            success=False,
            stdout="",
            stderr="",
            return_code=-1,
            error=f"Failed to start Streamlit: {str(e)}"
        )


def run_script(script_path: Path, project_folder: Path, timeout: int = 300) -> ScriptResult:
    """
    Execute a Python script. Detects Streamlit scripts and runs them as background processes.

    Args:
        script_path: Path to the script
        project_folder: Working directory for execution
        timeout: Maximum execution time in seconds (default 5 minutes)

    Returns:
        ScriptResult with execution details
    """
    if not script_path.exists():
        return ScriptResult(
            script_path=str(script_path),
            success=False,
            stdout="",
            stderr="",
            return_code=-1,
            error=f"Script not found: {script_path}"
        )

    # Check if this is a Streamlit script
    if is_streamlit_script(script_path):
        return run_streamlit_script(script_path, project_folder)

    # Regular Python script execution
    process = None
    try:
        process = subprocess.Popen(
            [sys.executable, str(script_path)],
            cwd=str(project_folder),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        running_processes.append(process)

        try:
            stdout, stderr = process.communicate(timeout=timeout)
        finally:
            if process in running_processes:
                running_processes.remove(process)

        return ScriptResult(
            script_path=str(script_path),
            success=process.returncode == 0,
            stdout=stdout,
            stderr=stderr,
            return_code=process.returncode
        )

    except subprocess.TimeoutExpired:
        if process:
            process.kill()
            process.communicate()  # Clean up
            if process in running_processes:
                running_processes.remove(process)
        return ScriptResult(
            script_path=str(script_path),
            success=False,
            stdout="",
            stderr="",
            return_code=-1,
            error=f"Script timed out after {timeout} seconds",
            timed_out=True
        )

    except Exception as e:
        if process and process in running_processes:
            running_processes.remove(process)
        return ScriptResult(
            script_path=str(script_path),
            success=False,
            stdout="",
            stderr="",
            return_code=-1,
            error=str(e)
        )


def stop_all_scripts() -> int:
    """
    Stop all currently running scripts, including Streamlit apps.

    Returns:
        Number of processes that were stopped
    """
    stopped = 0

    # Stop regular running processes
    for process in running_processes[:]:  # Copy list to avoid modification during iteration
        try:
            process.terminate()  # Try graceful termination first
            try:
                process.wait(timeout=2)  # Wait up to 2 seconds
            except subprocess.TimeoutExpired:
                process.kill()  # Force kill if still running
            stopped += 1
        except Exception:
            pass  # Process may have already exited
        finally:
            if process in running_processes:
                running_processes.remove(process)

    # Stop Streamlit processes
    for script_key, process in list(streamlit_processes.items()):
        try:
            process.terminate()
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()
            stopped += 1
        except Exception:
            pass
        finally:
            if script_key in streamlit_processes:
                del streamlit_processes[script_key]

    return stopped


def list_running_processes() -> list[dict]:
    """
    List all currently running processes.

    Returns:
        List of process info dicts with pid, script_path, type, and status
    """
    processes = []

    # Check Streamlit processes
    for script_path, process in list(streamlit_processes.items()):
        poll_result = process.poll()
        if poll_result is None:
            # Still running
            processes.append({
                "pid": process.pid,
                "script_path": script_path,
                "script_name": Path(script_path).name,
                "type": "streamlit",
                "status": "running"
            })
        else:
            # Process ended, clean up
            del streamlit_processes[script_path]

    # Check regular running processes
    for process in running_processes[:]:
        poll_result = process.poll()
        if poll_result is None:
            processes.append({
                "pid": process.pid,
                "script_path": str(process.args[1]) if len(process.args) > 1 else "unknown",
                "script_name": Path(process.args[1]).name if len(process.args) > 1 else "unknown",
                "type": "python",
                "status": "running"
            })
        else:
            running_processes.remove(process)

    return processes


def stop_process(pid: int) -> bool:
    """
    Stop a specific process by PID.

    Args:
        pid: Process ID to stop

    Returns:
        True if process was stopped, False if not found
    """
    import os
    import signal

    # Check Streamlit processes
    for script_path, process in list(streamlit_processes.items()):
        if process.pid == pid:
            try:
                process.terminate()
                try:
                    process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    process.kill()
                del streamlit_processes[script_path]
                return True
            except Exception:
                return False

    # Check regular running processes
    for process in running_processes[:]:
        if process.pid == pid:
            try:
                process.terminate()
                try:
                    process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    process.kill()
                running_processes.remove(process)
                return True
            except Exception:
                return False

    # Try to kill by PID directly as fallback
    try:
        os.kill(pid, signal.SIGTERM)
        return True
    except (ProcessLookupError, PermissionError):
        return False


def setup_project_structure(project_folder: Path) -> dict[str, Path]:
    """
    Ensure the expected folder structure exists.

    Args:
        project_folder: Root project folder

    Returns:
        Dict with paths to input_folder, output_folder, app_folder, scripts_folder, meta_folder
    """
    folders = {
        "input_folder": project_folder / "input_folder",
        "output_folder": project_folder / "output_folder",
        "app_folder": project_folder / "app_folder",
        "scripts_folder": project_folder / "app_folder" / "scripts",
        "meta_folder": project_folder / "app_folder" / "meta_data",
    }

    for folder in folders.values():
        folder.mkdir(parents=True, exist_ok=True)

    return folders
