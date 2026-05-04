"""
Builds the geo_dashboard PWA into a Track 2 distributable package at
output_folder/geo_dashboard/. Reuses the dev-asset prep flow, runs the Vite
production build, then assembles the launcher trio plus application_files/.
"""
import os
import shutil
import subprocess
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(SCRIPT_DIR)))
OUTPUT_FOLDER = os.path.join(PROJECT_DIR, "output_folder")
APP_CORE_DIR = os.path.join(SCRIPT_DIR, "app_core")

sys.path.insert(0, APP_CORE_DIR)

from prepare_dev_assets import prepare_dev_assets

APP_NAME = os.path.basename(SCRIPT_DIR)
PACKAGE_DIR = os.path.join(OUTPUT_FOLDER, APP_NAME)
APP_FILES = os.path.join(PACKAGE_DIR, "application_files")

APP_SOURCE_DIR = os.path.join(APP_CORE_DIR, "src_app")
# Vite's outDir is "../dist" relative to root="src_app", so dist lands inside app_core/.
DIST_DIR = os.path.join(APP_CORE_DIR, "dist")


def banner(msg):
    line = "=" * 60
    print(f"\n{line}\n {msg}\n{line}")


def run(cmd, cwd):
    print(f"  $ {' '.join(cmd)}")
    result = subprocess.run(cmd, cwd=cwd)
    if result.returncode != 0:
        sys.exit(result.returncode)


def vite_build():
    if os.path.exists(DIST_DIR):
        shutil.rmtree(DIST_DIR)
    run(["npm", "run", "build"], cwd=APP_CORE_DIR)


def assemble_package():
    if os.path.exists(PACKAGE_DIR):
        shutil.rmtree(PACKAGE_DIR)
    os.makedirs(APP_FILES, exist_ok=True)

    # Copy Vite build output into application_files/
    for entry in os.listdir(DIST_DIR):
        src = os.path.join(DIST_DIR, entry)
        dst = os.path.join(APP_FILES, entry)
        if os.path.isdir(src):
            shutil.copytree(src, dst)
        else:
            shutil.copy2(src, dst)

    write_serve_ps1(os.path.join(APP_FILES, "serve.ps1"))
    write_pc_start(os.path.join(PACKAGE_DIR, "pc_start.bat"))
    write_mac_start(os.path.join(PACKAGE_DIR, "mac_start.command"))
    write_mac_start(os.path.join(PACKAGE_DIR, "mac_start.sh"))
    os.chmod(os.path.join(PACKAGE_DIR, "mac_start.command"), 0o755)
    os.chmod(os.path.join(PACKAGE_DIR, "mac_start.sh"), 0o755)


def write_serve_ps1(path):
    content = r"""# PowerShell static HTTP server for the Outlet Geo Dashboard PWA.
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
echo  Outlet Geo Dashboard
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
echo " Outlet Geo Dashboard"
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
    banner("Outlet Geo Dashboard — build_app_package")
    print(f"App:     {APP_NAME}")
    print(f"Package: {PACKAGE_DIR}")
    print()

    banner("[1/3] Prepare dev assets")
    prepare_dev_assets()

    banner("[2/3] Vite build")
    vite_build()

    banner("[3/3] Assemble distributable package")
    assemble_package()

    banner("Done")
    print(f"Distributable package: {PACKAGE_DIR}")
    print("To launch locally:")
    print(f"  Mac:     bash {os.path.join(PACKAGE_DIR, 'mac_start.sh')}")
    print(f"  Windows: {os.path.join(PACKAGE_DIR, 'pc_start.bat')}")


if __name__ == "__main__":
    main()
