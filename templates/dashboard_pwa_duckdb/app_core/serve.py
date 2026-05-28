"""
Static HTTP server for local dashboard_pwa_duckdb development.
Serves the src_app/ folder, picks a free port, and registers .wasm + .parquet
MIME types so DuckDB-WASM and parquet fetches work in the browser.
"""
import http.server
import mimetypes
import os
import socket
import socketserver
import sys
import webbrowser

mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("application/octet-stream", ".parquet")
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("application/json", ".json")

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SERVE_ROOT = os.path.join(SCRIPT_DIR, "src_app")


def find_free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def main():
    if not os.path.isdir(SERVE_ROOT):
        print(f"src_app/ not found at {SERVE_ROOT}", file=sys.stderr)
        sys.exit(1)

    os.chdir(SERVE_ROOT)
    port = find_free_port()
    url = f"http://127.0.0.1:{port}/"
    print(f"Serving {SERVE_ROOT}")
    print(f"Open {url}")
    print("Press Ctrl+C to stop.")
    try:
        webbrowser.open(url)
    except Exception:
        pass

    with socketserver.TCPServer(("127.0.0.1", port), http.server.SimpleHTTPRequestHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down.")


if __name__ == "__main__":
    main()
