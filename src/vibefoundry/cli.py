"""
CLI entry point for VibeFoundry IDE
"""

import argparse
import os
import signal
import socket
import sys
import threading
import time
import json
import urllib.request
import urllib.error
from pathlib import Path
from typing import Optional

import uvicorn

from vibefoundry import __version__
from vibefoundry.browser import launch_app_mode


def find_available_port(start_port: int = 8765, max_attempts: int = 100) -> int:
    """Find an available port starting from start_port"""
    for port in range(start_port, start_port + max_attempts):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            try:
                sock.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise RuntimeError(f"Could not find available port in range {start_port}-{start_port + max_attempts}")


def find_running_backends(start: int = 8765, end: int = 8799) -> list[dict]:
    """Probe the local port range for VibeFoundry backends.

    Identifies them by /api/health rather than by process name, so it only ever
    reports (and --kill only ever stops) something that really is one of ours.
    The pid comes from the health payload; older backends predate it and report
    None, in which case we can list but not stop them.

    The timeout is deliberately generous: a backend rooted at a huge folder (a
    `vibefoundry` launched from $HOME indexes everything) can take over a second
    to answer, and a tight timeout made --list miss exactly the overloaded strays
    you're trying to find.
    """
    found = []
    for port in range(start, end + 1):
        if not _port_open(port):
            continue  # nothing here at all — skip the expensive probe

        data = None
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=1.5) as r:
                if r.status == 200:
                    data = json.loads(r.read().decode())
        except Exception:
            data = None  # open but not answering — see below

        pid = _pid_on_port(port)
        if data is None:
            # The port is held but health didn't answer. Don't skip it: a backend
            # wedged by a huge project folder (e.g. launched from $HOME) is
            # exactly the one worth killing, and identifying strays by health
            # alone goes blind precisely when they're broken. Only claim it if a
            # process actually holds the port.
            if pid is None:
                continue
            found.append({
                "port": port, "pid": pid, "version": None,
                "project_folder": None, "unresponsive": True,
            })
            continue

        if data.get("status") != "ok":
            continue  # something else is listening here
        found.append({
            "port": port,
            "pid": data.get("pid") or pid,
            "version": data.get("version"),
            "project_folder": data.get("project_folder"),
            "unresponsive": False,
        })
    return found


def _port_open(port: int) -> bool:
    """Is anything listening? Cheap, and never blocks on a wedged server."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.2)
        return s.connect_ex(("127.0.0.1", port)) == 0


def _pid_on_port(port: int) -> Optional[int]:
    """Who holds this port? Used when health can't answer for itself."""
    import subprocess
    try:
        if sys.platform == "win32":
            out = subprocess.run(
                ["netstat", "-ano", "-p", "TCP"], capture_output=True, text=True, timeout=5
            ).stdout
            for line in out.splitlines():
                parts = line.split()
                if len(parts) >= 5 and parts[1].endswith(f":{port}") and parts[3] == "LISTENING":
                    return int(parts[4])
            return None
        out = subprocess.run(
            ["lsof", "-ti", f"tcp:{port}", "-sTCP:LISTEN"],
            capture_output=True, text=True, timeout=5,
        ).stdout.strip()
        return int(out.split("\n")[0]) if out else None
    except Exception:
        return None


def run_server(port: int, host: str = "127.0.0.1"):
    """Run the FastAPI server"""
    uvicorn.run(
        "vibefoundry.server:app",
        host=host,
        port=port,
        log_level="warning",
        access_log=False
    )


def main(args: Optional[list[str]] = None):
    """Main entry point for vibefoundry CLI"""
    parser = argparse.ArgumentParser(
        prog="vibefoundry",
        description="VibeFoundry IDE - A local IDE for data science workflows"
    )
    parser.add_argument(
        "folder",
        nargs="?",
        default=None,
        help="Project folder to open (optional, can be selected in UI)"
    )
    parser.add_argument(
        "--version", "-v",
        action="version",
        version=f"vibefoundry {__version__}"
    )
    parser.add_argument(
        "--port", "-p",
        type=int,
        default=None,
        help="Port to run the server on (default: auto-detect)"
    )
    parser.add_argument(
        "--host",
        type=str,
        default="127.0.0.1",
        help="Host to bind the server to (default: 127.0.0.1)"
    )
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="Don't open the browser automatically"
    )
    parser.add_argument(
        "--pane",
        action="store_true",
        help="Embedded-pane mode (Claude Code preview): serve the neutral pane "
             "theme and trimmed chrome, and auto-redirect the root to ?pane=1"
    )
    parser.add_argument(
        "--dev",
        action="store_true",
        help="Run in development mode (enables CORS, detailed logging)"
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="List VibeFoundry backends currently running on this machine"
    )
    parser.add_argument(
        "--kill",
        action="store_true",
        help="Stop every running VibeFoundry backend (frees their ports)"
    )

    parsed_args = parser.parse_args(args)

    if parsed_args.list or parsed_args.kill:
        found = find_running_backends()
        if not found:
            print("No VibeFoundry backends are running.")
            return
        for b in found:
            if b.get("unresponsive"):
                print(f"  port {b['port']}  pid {b['pid'] or '?'}  NOT RESPONDING "
                      f"(wedged — often a huge project folder, e.g. launched from your home directory)")
            else:
                print(f"  port {b['port']}  pid {b['pid'] or '?'}  v{b['version'] or '?'}  "
                      f"{b['project_folder'] or '(no folder)'}")
        if parsed_args.kill:
            killed = 0
            skipped = []
            for b in found:
                if not b["pid"]:
                    # Pre-0.2.32 backends don't report a pid. Say so rather than
                    # quietly leaving them running and claiming success.
                    skipped.append(b)
                    continue
                try:
                    os.kill(b["pid"], signal.SIGTERM)
                    killed += 1
                except OSError as e:
                    print(f"  could not stop pid {b['pid']}: {e}")
            print(f"Stopped {killed} backend(s).")
            for b in skipped:
                print(
                    f"  NOT stopped: port {b['port']} ({b['project_folder']}) — it predates "
                    f"--kill and doesn't report its pid. Close its window, or: "
                    f"lsof -ti tcp:{b['port']} | xargs kill"
                )
        return

    # Handle project folder - use current directory if not specified
    if parsed_args.folder:
        project_folder = Path(parsed_args.folder).resolve()
    else:
        project_folder = Path.cwd()

    if not project_folder.exists():
        print(f"Error: Folder does not exist: {project_folder}")
        sys.exit(1)
    if not project_folder.is_dir():
        print(f"Error: Not a directory: {project_folder}")
        sys.exit(1)

    # Set environment variable for server to pick up
    os.environ["VIBEFOUNDRY_PROJECT_PATH"] = str(project_folder)
    print(f"Project folder: {project_folder}")

    # Embedded-pane mode: the server redirects the root to ?pane=1 so the
    # frontend renders the neutral pane theme + trimmed chrome.
    if parsed_args.pane:
        os.environ["VIBEFOUNDRY_PANE"] = "1"

    # Find available port
    port = parsed_args.port or find_available_port()
    host = parsed_args.host
    local_url = f"http://{host}:{port}"

    # The server builds OAuth redirect URIs from this — the port is only known
    # here, and it drifts off 8765 whenever that port is already taken.
    os.environ["VIBEFOUNDRY_PORT"] = str(port)

    print(f"Starting VibeFoundry IDE v{__version__}")
    print(f"App: {local_url}")

    # Handle Ctrl+C gracefully
    shutdown_event = threading.Event()

    def signal_handler(signum, frame):
        print("\nShutting down...")
        shutdown_event.set()
        sys.exit(0)

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    # Start server in background thread
    server_thread = threading.Thread(
        target=run_server,
        args=(port, host),
        daemon=True
    )
    server_thread.start()

    # Wait for server to be ready (health-check poll instead of fixed sleep)
    health_url = f"{local_url}/api/health"
    max_wait = 15  # seconds
    poll_interval = 0.2  # seconds
    waited = 0.0
    server_ready = False

    while waited < max_wait:
        try:
            req = urllib.request.urlopen(health_url, timeout=1)
            if req.status == 200:
                server_ready = True
                break
        except (urllib.error.URLError, ConnectionError, OSError):
            pass
        time.sleep(poll_interval)
        waited += poll_interval

    if not server_ready:
        print("Warning: Server may not be fully ready, opening browser anyway...")

    # Open browser
    if not parsed_args.no_browser:
        app_mode = launch_app_mode(local_url)
        if app_mode:
            print("Opened in app mode (Chrome/Edge)")
        else:
            print("Opened in default browser")

    print("\nPress Ctrl+C to stop the server")

    # Keep main thread alive
    try:
        while not shutdown_event.is_set():
            time.sleep(0.5)
    except KeyboardInterrupt:
        print("\nShutting down...")


if __name__ == "__main__":
    main()
