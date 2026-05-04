"""
Cross-platform dev HTTP server for the trend_analytics_dashboard
plain-script PWA. Picks a free port, opens the browser, and serves
the src_app/ folder. Replaces the previous Vite-based dev server.
Run via run_app.sh / run_app.bat (which call prepare_dev_assets.py
first).
"""
import http.server
import os
import socket
import socketserver
import sys
import threading
import webbrowser

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SERVE_DIR = os.path.join(SCRIPT_DIR, "src_app")


def free_port() -> int:
    s = socket.socket()
    s.bind(("", 0))
    port = s.getsockname()[1]
    s.close()
    return port


class Handler(http.server.SimpleHTTPRequestHandler):
    """Adds correct WASM mime type + COOP/COEP for SharedArrayBuffer."""
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".wasm": "application/wasm",
        ".js":   "application/javascript",
        ".mjs":  "application/javascript",
        ".css":  "text/css",
        ".json": "application/json",
        ".parquet": "application/octet-stream",
    }

    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


def main():
    if not os.path.isdir(SERVE_DIR):
        print(f"ERROR: serve dir not found: {SERVE_DIR}")
        sys.exit(1)
    os.chdir(SERVE_DIR)

    port = free_port()
    url = f"http://127.0.0.1:{port}/"
    print(f"Serving on {url}")
    print(f"Edit files in {SERVE_DIR}, then refresh your browser.")
    print("Press Ctrl+C to stop.")

    threading.Timer(0.8, lambda: webbrowser.open(url)).start()

    with socketserver.TCPServer(("", port), Handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopping.")


if __name__ == "__main__":
    main()
