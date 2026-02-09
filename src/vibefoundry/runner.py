"""
Script discovery and execution
"""

import sys
import subprocess
from pathlib import Path
from dataclasses import dataclass
from typing import Optional


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


def run_script(script_path: Path, project_folder: Path, timeout: int = 300) -> ScriptResult:
    """
    Execute a Python script.

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

    try:
        result = subprocess.run(
            [sys.executable, str(script_path)],
            cwd=str(project_folder),
            capture_output=True,
            text=True,
            timeout=timeout
        )

        return ScriptResult(
            script_path=str(script_path),
            success=result.returncode == 0,
            stdout=result.stdout,
            stderr=result.stderr,
            return_code=result.returncode
        )

    except subprocess.TimeoutExpired:
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
        return ScriptResult(
            script_path=str(script_path),
            success=False,
            stdout="",
            stderr="",
            return_code=-1,
            error=str(e)
        )


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
