"""
Prepares the geo_dashboard template for local Vite development by staging the
dataset, installing npm dependencies if needed, and generating browser assets.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(SCRIPT_DIR))))
INPUT_FOLDER = os.path.join(PROJECT_DIR, "input_folder")
APP_SOURCE_DIR = os.path.join(SCRIPT_DIR, "src_app")

PUBLIC_DATA = os.path.join(APP_SOURCE_DIR, "public", "data")
PUBLIC_LIB = os.path.join(APP_SOURCE_DIR, "public", "lib")
SAMPLE_DATA = os.path.join(SCRIPT_DIR, "sample_data")
CONFIG_PATH = os.path.join(PUBLIC_DATA, "app_config.json")


def run(cmd, cwd):
    print(f"  $ {' '.join(cmd)}")
    result = subprocess.run(cmd, cwd=cwd)
    if result.returncode != 0:
        sys.exit(result.returncode)


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


def npm_install_if_needed():
    node_modules = os.path.join(SCRIPT_DIR, "node_modules")
    pkg_lock = os.path.join(SCRIPT_DIR, "package-lock.json")
    if os.path.exists(node_modules) and os.path.exists(pkg_lock):
        if os.path.getmtime(node_modules) >= os.path.getmtime(pkg_lock):
            print("[npm] node_modules is up to date — skipping install.")
            return
    run(["npm", "install"], cwd=SCRIPT_DIR)


def download(url, target):
    if os.path.exists(target) and os.path.getsize(target) > 0:
        return
    print(f"[lib] Downloading {os.path.basename(target)}")
    urllib.request.urlretrieve(url, target)


def ensure_browser_libs():
    os.makedirs(PUBLIC_LIB, exist_ok=True)

    download("https://unpkg.com/react@18/umd/react.production.min.js", os.path.join(PUBLIC_LIB, "react.min.js"))
    download("https://unpkg.com/react-dom@18/umd/react-dom.production.min.js", os.path.join(PUBLIC_LIB, "react-dom.min.js"))
    download("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js", os.path.join(PUBLIC_LIB, "leaflet.js"))
    download("https://unpkg.com/leaflet@1.9.4/dist/leaflet.css", os.path.join(PUBLIC_LIB, "leaflet.css"))

    duckdb_dist = os.path.join(SCRIPT_DIR, "node_modules", "@duckdb", "duckdb-wasm", "dist")
    wasm_src = os.path.join(duckdb_dist, "duckdb-eh.wasm")
    worker_src = os.path.join(duckdb_dist, "duckdb-browser-eh.worker.js")
    if not os.path.exists(wasm_src) or not os.path.exists(worker_src):
        raise SystemExit("[lib] DuckDB-WASM files are missing. Run npm install and retry.")

    shutil.copy2(wasm_src, os.path.join(PUBLIC_LIB, "duckdb-eh.wasm"))
    shutil.copy2(worker_src, os.path.join(PUBLIC_LIB, "duckdb-browser-eh.worker.js"))

    with tempfile.TemporaryDirectory(dir=SCRIPT_DIR) as tmp:
        entry = os.path.join(tmp, "duckdb_entry.js")
        with open(entry, "w") as f:
            f.write("import * as duckdb from '@duckdb/duckdb-wasm';\nwindow.duckdb = duckdb;\n")
        run([
            "npx",
            "esbuild",
            entry,
            "--bundle",
            "--format=iife",
            "--platform=browser",
            "--target=es2020",
            "--outfile=" + os.path.join(PUBLIC_LIB, "duckdb-bundle.js"),
        ], cwd=SCRIPT_DIR)


def prepare_dev_assets():
    resolve_dataset()
    npm_install_if_needed()
    ensure_browser_libs()


def main():
    prepare_dev_assets()


if __name__ == "__main__":
    main()
