"""
Script discovery and execution
"""

import sys
import subprocess
import signal
import re
import time
import threading
import platform
import shutil
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
    Find all scripts in the scripts folder (.py, .bat, .sh).

    Args:
        scripts_folder: Path to app_folder/scripts/

    Returns:
        List of script paths sorted alphabetically
    """
    if not scripts_folder.exists():
        return []

    scripts = []
    for ext in ("*.py", "*.bat", "*.sh"):
        scripts.extend(scripts_folder.glob(f"**/{ext}"))
    return sorted(scripts)


def get_script_command(script_path: Path) -> tuple[list[str], str]:
    """
    Get the command to run a script based on its extension.

    Args:
        script_path: Path to the script

    Returns:
        Tuple of (command list, script type string)
    """
    ext = script_path.suffix.lower()

    if ext == ".py":
        return [sys.executable, str(script_path)], "python"

    elif ext == ".bat":
        # Windows batch files
        if platform.system() == "Windows":
            return ["cmd.exe", "/c", str(script_path)], "batch"
        else:
            # On non-Windows, try to run with cmd if available (e.g., Wine)
            # but most likely this won't work - return error-friendly command
            return ["cmd.exe", "/c", str(script_path)], "batch"

    elif ext == ".sh":
        # Shell scripts - find bash or sh
        bash_path = shutil.which("bash")
        if bash_path:
            return [bash_path, str(script_path)], "shell"
        sh_path = shutil.which("sh")
        if sh_path:
            return [sh_path, str(script_path)], "shell"
        # Fallback - will likely fail on Windows without bash
        return ["bash", str(script_path)], "shell"

    # Unknown extension - try to run directly
    return [str(script_path)], "unknown"


def detect_localhost_urls(script_path: Path) -> list[str]:
    """
    Scan a script file for localhost URLs.

    Args:
        script_path: Path to the script

    Returns:
        List of localhost URLs found in the script
    """
    urls = []
    try:
        content = script_path.read_text(encoding='utf-8')
        # Match localhost URLs with ports
        url_pattern = re.compile(r'https?://localhost:\d+')
        urls = list(set(url_pattern.findall(content)))
        # Sort by port number for consistency
        urls.sort(key=lambda u: int(re.search(r':(\d+)', u).group(1)))
    except Exception:
        pass
    return urls


def run_shell_script_in_terminal(script_path: Path, project_folder: Path) -> ScriptResult:
    """
    Run a shell script in a new terminal window and open detected URLs in browser.

    Args:
        script_path: Path to the shell script
        project_folder: Working directory for execution

    Returns:
        ScriptResult indicating the script was launched
    """
    import webbrowser

    # Detect URLs in the script to open in browser
    urls = detect_localhost_urls(script_path)

    system = platform.system()

    try:
        if system == "Darwin":  # macOS
            # Use osascript to open Terminal and run the script
            apple_script = f'''
            tell application "Terminal"
                activate
                do script "cd '{project_folder}' && bash '{script_path}'"
            end tell
            '''
            subprocess.Popen(
                ["osascript", "-e", apple_script],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )

        elif system == "Windows":
            # Open cmd window and run the script
            # For .sh on Windows, try Git Bash first
            git_bash = shutil.which("bash")
            if git_bash:
                subprocess.Popen(
                    ["cmd", "/c", "start", "bash", str(script_path)],
                    cwd=str(project_folder),
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL
                )
            else:
                return ScriptResult(
                    script_path=str(script_path),
                    success=False,
                    stdout="",
                    stderr="",
                    return_code=-1,
                    error="Cannot run .sh files on Windows without Git Bash installed"
                )

        else:  # Linux
            # Try common terminal emulators
            terminals = [
                ["gnome-terminal", "--", "bash", str(script_path)],
                ["xterm", "-e", f"bash '{script_path}'"],
                ["konsole", "-e", f"bash '{script_path}'"],
            ]
            launched = False
            for term_cmd in terminals:
                if shutil.which(term_cmd[0]):
                    subprocess.Popen(
                        term_cmd,
                        cwd=str(project_folder),
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL
                    )
                    launched = True
                    break
            if not launched:
                return ScriptResult(
                    script_path=str(script_path),
                    success=False,
                    stdout="",
                    stderr="",
                    return_code=-1,
                    error="No supported terminal emulator found (tried gnome-terminal, xterm, konsole)"
                )

        # Give the script a moment to start, then open URLs
        if urls:
            time.sleep(2)
            for url in urls:
                webbrowser.open(url)

        url_msg = f"\nOpened in browser: {', '.join(urls)}" if urls else ""
        return ScriptResult(
            script_path=str(script_path),
            success=True,
            stdout=f"Script launched in new terminal window.{url_msg}\n\nUse the terminal window to see output and Ctrl+C to stop.",
            stderr="",
            return_code=0
        )

    except Exception as e:
        return ScriptResult(
            script_path=str(script_path),
            success=False,
            stdout="",
            stderr="",
            return_code=-1,
            error=f"Failed to launch terminal: {str(e)}"
        )


def run_batch_script_in_terminal(script_path: Path, project_folder: Path) -> ScriptResult:
    """
    Run a batch script (.bat) in a new terminal window and open detected URLs in browser.

    Args:
        script_path: Path to the batch script
        project_folder: Working directory for execution

    Returns:
        ScriptResult indicating the script was launched
    """
    import webbrowser

    # Detect URLs in the script to open in browser
    urls = detect_localhost_urls(script_path)

    system = platform.system()

    try:
        if system == "Windows":
            # Open a new cmd window and run the batch file
            subprocess.Popen(
                ["cmd", "/c", "start", "cmd", "/k", str(script_path)],
                cwd=str(project_folder),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
        elif system == "Darwin":  # macOS
            # Use osascript to open Terminal - bat files won't run natively but show message
            return ScriptResult(
                script_path=str(script_path),
                success=False,
                stdout="",
                stderr="",
                return_code=-1,
                error=".bat files can only run on Windows. Use .sh for macOS/Linux."
            )
        else:  # Linux
            return ScriptResult(
                script_path=str(script_path),
                success=False,
                stdout="",
                stderr="",
                return_code=-1,
                error=".bat files can only run on Windows. Use .sh for Linux."
            )

        # Give the script a moment to start, then open URLs
        if urls:
            time.sleep(2)
            for url in urls:
                webbrowser.open(url)

        url_msg = f"\nOpened in browser: {', '.join(urls)}" if urls else ""
        return ScriptResult(
            script_path=str(script_path),
            success=True,
            stdout=f"Script launched in new command window.{url_msg}\n\nUse the command window to see output and Ctrl+C to stop.",
            stderr="",
            return_code=0
        )

    except Exception as e:
        return ScriptResult(
            script_path=str(script_path),
            success=False,
            stdout="",
            stderr="",
            return_code=-1,
            error=f"Failed to launch command window: {str(e)}"
        )


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
    Execute a script (.py, .bat, or .sh). Detects Streamlit scripts and runs them as background processes.

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

    # Check if this is a Streamlit script (only for .py files)
    if script_path.suffix.lower() == ".py" and is_streamlit_script(script_path):
        return run_streamlit_script(script_path, project_folder)

    # Shell scripts run in a new terminal window with auto-browser
    if script_path.suffix.lower() == ".sh":
        return run_shell_script_in_terminal(script_path, project_folder)

    # Batch scripts run in a new cmd window with auto-browser
    if script_path.suffix.lower() == ".bat":
        return run_batch_script_in_terminal(script_path, project_folder)

    # Get the command for this script type
    command, script_type = get_script_command(script_path)

    # Script execution
    process = None
    try:
        process = subprocess.Popen(
            command,
            cwd=str(project_folder),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            shell=(platform.system() == "Windows" and script_type == "batch")
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
            # Determine script path from args
            script_path = "unknown"
            if len(process.args) > 1:
                # Script path is usually the last argument
                script_path = str(process.args[-1])

            # Determine type from extension
            script_type = "python"
            if script_path != "unknown":
                ext = Path(script_path).suffix.lower()
                if ext == ".bat":
                    script_type = "batch"
                elif ext == ".sh":
                    script_type = "shell"

            processes.append({
                "pid": process.pid,
                "script_path": script_path,
                "script_name": Path(script_path).name if script_path != "unknown" else "unknown",
                "type": script_type,
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
