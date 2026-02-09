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
        "--dev",
        action="store_true",
        help="Run in development mode (enables CORS, detailed logging)"
    )

    parsed_args = parser.parse_args(args)

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

    # Find available port
    port = parsed_args.port or find_available_port()
    host = parsed_args.host
    url = f"http://{host}:{port}"

    print(f"Starting VibeFoundry IDE v{__version__}")
    print(f"Server: {url}")

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

    # Wait for server to start
    time.sleep(0.5)

    # Open browser
    if not parsed_args.no_browser:
        app_mode = launch_app_mode(url)
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
