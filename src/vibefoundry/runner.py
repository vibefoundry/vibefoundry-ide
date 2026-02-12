"""
Script discovery and execution
"""

import sys
import subprocess
import signal
from pathlib import Path
from dataclasses import dataclass
from typing import Optional

# Track running processes for stop functionality
running_processes: list[subprocess.Popen] = []


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
    """Check if a script uses Streamlit by looking for import statements."""
    try:
        content = script_path.read_text(encoding='utf-8')
        # Check for common streamlit import patterns
        return 'import streamlit' in content or 'from streamlit' in content
    except Exception:
        return False


# Track running Streamlit processes separately (they run in background)
streamlit_processes: dict[str, subprocess.Popen] = {}


def run_streamlit_script(script_path: Path, project_folder: Path, port: int = 8501) -> ScriptResult:
    """
    Run a Streamlit script in the background.

    Args:
        script_path: Path to the Streamlit script
        project_folder: Working directory for execution
        port: Port for Streamlit server (default 8501)

    Returns:
        ScriptResult indicating the app was started
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
        # Start Streamlit in the background
        cmd = [
            sys.executable, "-m", "streamlit", "run",
            str(script_path),
            "--server.headless", "true",
            "--server.port", str(port),
            "--browser.gatherUsageStats", "false"
        ]

        process = subprocess.Popen(
            cmd,
            cwd=str(project_folder),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )

        streamlit_processes[script_key] = process

        # Give it a moment to start
        import time
        time.sleep(1)

        # Check if process is still running
        if process.poll() is None:
            return ScriptResult(
                script_path=str(script_path),
                success=True,
                stdout=f"🚀 Streamlit app started at http://localhost:{port}\n\nOpen this URL in your browser to view the app.",
                stderr="",
                return_code=0
            )
        else:
            # Process exited, likely an error
            stdout, stderr = process.communicate()
            del streamlit_processes[script_key]
            return ScriptResult(
                script_path=str(script_path),
                success=False,
                stdout=stdout,
                stderr=stderr,
                return_code=process.returncode,
                error="Streamlit failed to start"
            )

    except Exception as e:
        return ScriptResult(
            script_path=str(script_path),
            success=False,
            stdout="",
            stderr="",
            return_code=-1,
            error=f"Failed to start Streamlit: {str(e)}"
        )


def stop_streamlit_apps() -> int:
    """Stop all running Streamlit apps."""
    stopped = 0
    for script_key in list(streamlit_processes.keys()):
        process = streamlit_processes[script_key]
        try:
            process.terminate()
            process.wait(timeout=2)
        except Exception:
            try:
                process.kill()
            except Exception:
                pass
        del streamlit_processes[script_key]
        stopped += 1
    return stopped


def run_script(script_path: Path, project_folder: Path, timeout: int = 300) -> ScriptResult:
    """
    Execute a Python script. Detects Streamlit scripts and runs them with 'streamlit run'.

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

    # Detect if this is a Streamlit script
    if is_streamlit_script(script_path):
        return run_streamlit_script(script_path, project_folder)

    process = None
    try:
        cmd = [sys.executable, str(script_path)]

        process = subprocess.Popen(
            cmd,
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
    Stop all currently running scripts (including Streamlit apps).

    Returns:
        Number of processes that were stopped
    """
    stopped = 0
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

    # Also stop any Streamlit apps
    stopped += stop_streamlit_apps()

    return stopped


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
