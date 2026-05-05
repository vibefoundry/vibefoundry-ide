"""
Builds the pwa_duckdb PWA into a Track 2 distributable package at
output_folder/{app_name}/. Vite-less: just stages parquets, copies static
src_app/ files, and writes the launcher trio (pc_start.bat, mac_start.command,
mac_start.sh) plus serve.ps1 inside application_files/.
"""
import os
import shutil
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(SCRIPT_DIR)))
OUTPUT_FOLDER = os.path.join(PROJECT_DIR, "output_folder")
APP_CORE_DIR = os.path.join(SCRIPT_DIR, "app_core")
APP_SOURCE_DIR = os.path.join(APP_CORE_DIR, "src_app")

sys.path.insert(0, APP_CORE_DIR)
from prepare_dev_assets import prepare_dev_assets

APP_NAME = os.path.basename(SCRIPT_DIR)
PACKAGE_DIR = os.path.join(OUTPUT_FOLDER, APP_NAME)
APP_FILES = os.path.join(PACKAGE_DIR, "application_files")


def banner(msg):
    line = "=" * 60
    print(f"\n{line}\n {msg}\n{line}")


def assemble_package():
    if os.path.exists(PACKAGE_DIR):
        shutil.rmtree(PACKAGE_DIR)
    shutil.copytree(APP_SOURCE_DIR, APP_FILES)

    write_serve_ps1(os.path.join(APP_FILES, "serve.ps1"))
    write_pc_start(os.path.join(PACKAGE_DIR, "pc_start.bat"))
    write_mac_start(os.path.join(PACKAGE_DIR, "mac_start.command"))
    write_mac_start(os.path.join(PACKAGE_DIR, "mac_start.sh"))
    os.chmod(os.path.join(PACKAGE_DIR, "mac_start.command"), 0o755)
    os.chmod(os.path.join(PACKAGE_DIR, "mac_start.sh"), 0o755)


def write_serve_ps1(path):
    content = r"""# PowerShell static HTTP server for the pwa_duckdb PWA.
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
echo  Data Viewer
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
    content = r"""#!/bin/bash
PACKAGE_DIR="$(cd "$(dirname "$0")" && pwd)"

# Strip quarantine from the whole package on first launch — Mac equivalent of Windows "Unblock".
xattr -dr com.apple.quarantine "$PACKAGE_DIR" 2>/dev/null

cd "$PACKAGE_DIR/application_files"
echo "========================================"
echo " Data Viewer"
echo "========================================"
echo ""
PORT=$(python3 -c "import socket; s=socket.socket(); s.bind(('127.0.0.1', 0)); print(s.getsockname()[1]); s.close()")
echo "Starting on http://localhost:$PORT"
echo "Press Ctrl+C to stop."
echo ""
open "http://localhost:$PORT"
python3 -m http.server "$PORT"
"""
    with open(path, "w") as f:
        f.write(content)


def main():
    banner(f"{APP_NAME} — build_app_package")
    print(f"Package: {PACKAGE_DIR}\n")

    banner("[1/2] Stage parquet datasets")
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
