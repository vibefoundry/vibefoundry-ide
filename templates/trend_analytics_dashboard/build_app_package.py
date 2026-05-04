"""
Builds the trend_analytics_dashboard PWA into a Track 2 distributable package
at output_folder/trend_analytics_dashboard/. Resolves the dataset (input_folder
first, sample_data fallback), runs `npm install` + `npm run build` (Vite), then
assembles the launcher trio + application_files/ structure.
"""
import json
import os
import shutil
import subprocess
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(SCRIPT_DIR)))
INPUT_FOLDER = os.path.join(PROJECT_DIR, "input_folder")
OUTPUT_FOLDER = os.path.join(PROJECT_DIR, "output_folder")

APP_NAME = os.path.basename(SCRIPT_DIR)
PACKAGE_DIR = os.path.join(OUTPUT_FOLDER, APP_NAME)
APP_FILES = os.path.join(PACKAGE_DIR, "application_files")

PUBLIC_DATA = os.path.join(SCRIPT_DIR, "public", "data")
PUBLIC_LIB = os.path.join(SCRIPT_DIR, "public", "lib")
SAMPLE_DATA = os.path.join(SCRIPT_DIR, "sample_data")
DIST_DIR = os.path.join(SCRIPT_DIR, "dist")
CONFIG_PATH = os.path.join(PUBLIC_DATA, "app_config.json")


def banner(msg):
    line = "=" * 60
    print(f"\n{line}\n {msg}\n{line}")


def resolve_dataset():
    """Stage the dataset into public/data/. Priority:
      1. input_folder/{file}   -> always wins (overwrites)
      2. existing public/data/ -> kept as-is (no-op)
      3. sample_data/sample.parquet -> fallback (never overwrites real data)
    """
    with open(CONFIG_PATH) as f:
        config = json.load(f)
    data_file = config["data"]["file"]
    target = os.path.join(PUBLIC_DATA, data_file)

    input_src = os.path.join(INPUT_FOLDER, data_file)
    sample_src = os.path.join(SAMPLE_DATA, "sample.parquet")

    if os.path.exists(input_src):
        os.makedirs(PUBLIC_DATA, exist_ok=True)
        shutil.copy2(input_src, target)
        print(f"[data] Staged input_folder/{data_file} -> public/data/{data_file}")
        return "input_folder"

    if os.path.exists(target) and os.path.getsize(target) > 0:
        print(f"[data] Using existing public/data/{data_file} (size: {os.path.getsize(target):,} bytes).")
        return "existing"

    if os.path.exists(sample_src):
        os.makedirs(PUBLIC_DATA, exist_ok=True)
        shutil.copy2(sample_src, target)
        print(f"[data] Staged sample_data/sample.parquet -> public/data/{data_file}")
        print("[data] *** USING SAMPLE DATA *** Drop the real parquet in input_folder/ to switch.")
        return "sample_data"

    raise SystemExit(
        f"[data] No dataset available. Provide one at:\n"
        f"  - {input_src}\n"
        f"  - {sample_src}\n"
        f"  - {target}\n"
    )


def run(cmd, cwd):
    print(f"  $ {' '.join(cmd)}")
    result = subprocess.run(cmd, cwd=cwd)
    if result.returncode != 0:
        sys.exit(result.returncode)


def npm_install_if_needed():
    node_modules = os.path.join(SCRIPT_DIR, "node_modules")
    pkg_lock = os.path.join(SCRIPT_DIR, "package-lock.json")
    if os.path.exists(node_modules) and os.path.exists(pkg_lock):
        if os.path.getmtime(node_modules) >= os.path.getmtime(pkg_lock):
            print("[npm] node_modules is up to date — skipping install.")
            return
    run(["npm", "install"], cwd=SCRIPT_DIR)


def vite_build():
    if os.path.exists(DIST_DIR):
        shutil.rmtree(DIST_DIR)
    run(["npm", "run", "build"], cwd=SCRIPT_DIR)


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
    content = r"""# PowerShell static HTTP server for the Trend Analytics Dashboard PWA.
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
echo  Trend Analytics Dashboard
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
echo " Trend Analytics Dashboard"
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
    banner("Trend Analytics Dashboard — build_app_package")
    print(f"App:     {APP_NAME}")
    print(f"Package: {PACKAGE_DIR}")
    print()

    banner("[1/4] Resolve dataset")
    resolve_dataset()

    banner("[2/4] Install npm deps (if needed)")
    npm_install_if_needed()

    banner("[3/4] Vite build")
    vite_build()

    banner("[4/4] Assemble distributable package")
    assemble_package()

    banner("Done")
    print(f"Distributable package: {PACKAGE_DIR}")
    print("To launch locally:")
    print(f"  Mac:     bash {os.path.join(PACKAGE_DIR, 'mac_start.sh')}")
    print(f"  Windows: {os.path.join(PACKAGE_DIR, 'pc_start.bat')}")


if __name__ == "__main__":
    main()
