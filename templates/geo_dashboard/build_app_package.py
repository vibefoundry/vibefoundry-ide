"""
Build the geo_dashboard PWA into a Track 2 distributable package at
output_folder/geo_dashboard/.

Plain-script architecture — no Vite, no npm. Re-uses the dev-asset
prep flow (which downloads UMDs and stages data), then copies the
src_app/ tree as-is into the package's application_files/ directory.
The package's launcher trio (pc_start.bat, mac_start.command, mac_start.sh)
serves application_files/ via a static HTTP server on the recipient's
machine.
"""
import os
import shutil
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(SCRIPT_DIR)))
OUTPUT_FOLDER = os.path.join(PROJECT_DIR, "output_folder")
APP_CORE_DIR = os.path.join(SCRIPT_DIR, "app_core")
SRC_APP_DIR = os.path.join(APP_CORE_DIR, "src_app")

sys.path.insert(0, APP_CORE_DIR)
from prepare_dev_assets import prepare_dev_assets  # noqa: E402

APP_NAME = os.path.basename(SCRIPT_DIR)
PACKAGE_DIR = os.path.join(OUTPUT_FOLDER, APP_NAME)
APP_FILES = os.path.join(PACKAGE_DIR, "application_files")


def banner(msg):
    line = "=" * 60
    print(f"\n{line}\n {msg}\n{line}")


def assemble_package():
    """Wipe the output package, then copy src_app/ into application_files/."""
    if os.path.exists(PACKAGE_DIR):
        shutil.rmtree(PACKAGE_DIR)
    os.makedirs(PACKAGE_DIR, exist_ok=True)

    # Copy the entire src_app/ tree (HTML, JS, CSS, lib/, data/) into
    # application_files/. No bundling — the recipient's HTTP server
    # serves these files raw.
    shutil.copytree(SRC_APP_DIR, APP_FILES)

    write_serve_ps1(os.path.join(APP_FILES, "serve.ps1"))
    write_pc_start(os.path.join(PACKAGE_DIR, "pc_start.bat"))
    write_mac_start(os.path.join(PACKAGE_DIR, "mac_start.command"))
    write_mac_start(os.path.join(PACKAGE_DIR, "mac_start.sh"))
    os.chmod(os.path.join(PACKAGE_DIR, "mac_start.command"), 0o755)
    os.chmod(os.path.join(PACKAGE_DIR, "mac_start.sh"), 0o755)


def write_serve_ps1(path):
    """PowerShell static HTTP server. Sets COOP/COEP for DuckDB-WASM
    SharedArrayBuffer threading."""
    content = r"""# PowerShell static HTTP server for the Geo Dashboard PWA.
$probe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$probe.Start()
$port = $probe.LocalEndpoint.Port
$probe.Stop()

$url = "http://localhost:$port/"
Write-Host "Serving on $url"
Start-Process $url

$mime = @{
  ".html" = "text/html; charset=utf-8";
  ".js"   = "application/javascript";
  ".mjs"  = "application/javascript";
  ".css"  = "text/css";
  ".json" = "application/json";
  ".wasm" = "application/wasm";
  ".parquet" = "application/octet-stream";
  ".geojson" = "application/json";
  ".png"  = "image/png";
  ".jpg"  = "image/jpeg";
  ".svg"  = "image/svg+xml";
  ".ico"  = "image/x-icon";
}

$root = (Get-Location).Path
$http = [System.Net.HttpListener]::new()
$http.Prefixes.Add($url)
$http.Start()

try {
  while ($http.IsListening) {
    $ctx = $http.GetContext()
    $rel = $ctx.Request.Url.AbsolutePath.TrimStart('/')
    if ([string]::IsNullOrEmpty($rel)) { $rel = "index.html" }
    $file = Join-Path $root $rel
    # No COOP/COEP — would block OSM tile loading. DuckDB-WASM EH variant doesn't need it.
    $ctx.Response.Headers.Add("Cache-Control", "no-store")
    if (Test-Path $file -PathType Leaf) {
      $ext = [System.IO.Path]::GetExtension($file).ToLower()
      $ctx.Response.ContentType = $mime[$ext]
      if (-not $ctx.Response.ContentType) { $ctx.Response.ContentType = "application/octet-stream" }
      $bytes = [System.IO.File]::ReadAllBytes($file)
      $ctx.Response.ContentLength64 = $bytes.Length
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $ctx.Response.StatusCode = 404
    }
    $ctx.Response.OutputStream.Close()
  }
} finally {
  $http.Stop()
}
"""
    with open(path, "w") as f:
        f.write(content)


def write_pc_start(path):
    content = r"""@echo off
echo ========================================
echo  Geo Dashboard
echo ========================================
echo.
echo Starting server on an available port...
echo Close this window to stop the server.
echo.
cd /d "%~dp0application_files"
powershell -ExecutionPolicy Bypass -File "serve.ps1"
"""
    with open(path, "w", newline="\r\n") as f:
        f.write(content)


def write_mac_start(path):
    """Mac launcher — strips quarantine on first launch, picks a free
    port, then runs python3's http.server with COOP/COEP via a tiny
    custom handler."""
    content = r"""#!/bin/bash
PACKAGE_DIR="$(cd "$(dirname "$0")" && pwd)"

# Strip quarantine from the whole package on first launch — Mac equivalent of Windows "Unblock".
xattr -dr com.apple.quarantine "$PACKAGE_DIR" 2>/dev/null

cd "$PACKAGE_DIR/application_files"
echo "========================================"
echo " Geo Dashboard"
echo "========================================"
echo ""

# Use a small inline Python server that adds the COOP/COEP headers
# DuckDB-WASM needs for SharedArrayBuffer threading.
python3 - <<'PY'
import http.server, socket, socketserver, threading, time, webbrowser

class H(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".wasm": "application/wasm",
        ".js":   "application/javascript",
        ".mjs":  "application/javascript",
        ".css":  "text/css",
        ".json": "application/json",
        ".parquet": "application/octet-stream",
        ".geojson": "application/json",
    }
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()
    def log_message(self, *a, **k): pass

s = socket.socket(); s.bind(("",0)); port = s.getsockname()[1]; s.close()
url = f"http://localhost:{port}/"
print(f"Serving on {url}")
print("Press Ctrl+C to stop.")
threading.Timer(0.8, lambda: webbrowser.open(url)).start()
with socketserver.TCPServer(("", port), H) as httpd:
    try: httpd.serve_forever()
    except KeyboardInterrupt: print("\nStopping.")
PY
"""
    with open(path, "w") as f:
        f.write(content)


def main():
    banner("Geo Dashboard — build_app_package")
    print(f"App:     {APP_NAME}")
    print(f"Package: {PACKAGE_DIR}")
    print()

    banner("[1/2] Prepare dev assets (download UMDs, stage data)")
    prepare_dev_assets()

    banner("[2/2] Assemble distributable package")
    assemble_package()

    banner("Done")
    print(f"Distributable package: {PACKAGE_DIR}")
    print("To launch locally:")
    print(f"  Mac:     bash {os.path.join(PACKAGE_DIR, 'mac_start.sh')}")
    print(f"  Windows: {os.path.join(PACKAGE_DIR, 'pc_start.bat')}")


if __name__ == "__main__":
    main()
