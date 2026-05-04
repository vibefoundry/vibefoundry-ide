"""
Stage assets for the trend_analytics_dashboard PWA so it runs against
a plain HTTP server — no npm, no Vite, no bundler on the user's machine.

Downloads UMD/IIFE builds of every dependency to `src_app/lib/` so the
browser loads them via `<script>` tags. Resolves the dataset from
`input_folder/` (real data) or `sample_data/` (template fallback)
into `src_app/data/`.

Run by `run_app.sh` / `run_app.bat` before launching the HTTP server.
Re-running is cheap — already-staged libs are skipped.
"""
import json
import os
import shutil
import sys
import urllib.request

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(SCRIPT_DIR))))
INPUT_FOLDER = os.path.join(PROJECT_DIR, "input_folder")
APP_SOURCE_DIR = os.path.join(SCRIPT_DIR, "src_app")
APP_DATA_DIR = os.path.join(APP_SOURCE_DIR, "data")
APP_LIB_DIR = os.path.join(APP_SOURCE_DIR, "lib")
SAMPLE_DATA = os.path.join(SCRIPT_DIR, "sample_data")
CONFIG_PATH = os.path.join(APP_DATA_DIR, "app_config.json")

# UMD / IIFE asset URLs. Pinned versions for reproducibility.
ASSETS = [
    ("react.min.js",                "https://unpkg.com/react@18.3.1/umd/react.production.min.js"),
    ("react-dom.min.js",            "https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js"),
    ("chart.umd.js",                "https://unpkg.com/chart.js@4.4.0/dist/chart.umd.js"),
    ("duckdb-bundle.js",            "https://unpkg.com/@duckdb/duckdb-wasm@1.29.0/dist/duckdb-browser-eh.js"),
    ("duckdb-browser-eh.worker.js", "https://unpkg.com/@duckdb/duckdb-wasm@1.29.0/dist/duckdb-browser-eh.worker.js"),
    ("duckdb-eh.wasm",              "https://unpkg.com/@duckdb/duckdb-wasm@1.29.0/dist/duckdb-eh.wasm"),
]


def banner(msg):
    print("=" * 60)
    print(msg)
    print("=" * 60)


def resolve_dataset():
    """Stage the dataset into src_app/data/. Priority:
      1. input_folder/{file}    -> real data, always wins
      2. existing src_app/data/ -> kept as-is
      3. sample_data/sample.parquet -> template fallback
    """
    os.makedirs(APP_DATA_DIR, exist_ok=True)
    if not os.path.exists(CONFIG_PATH):
        print("[data] WARNING: app_config.json missing, skipping dataset staging")
        return
    with open(CONFIG_PATH) as f:
        config = json.load(f)
    data_file = config["data"]["file"]
    target = os.path.join(APP_DATA_DIR, data_file)

    real = os.path.join(INPUT_FOLDER, data_file)
    if os.path.exists(real):
        shutil.copy2(real, target)
        print(f"[data] real data: input_folder/{data_file}")
        return
    if os.path.exists(target):
        print(f"[data] kept existing: src_app/data/{data_file}")
        return
    sample = os.path.join(SAMPLE_DATA, "sample.parquet")
    if os.path.exists(sample):
        shutil.copy2(sample, target)
        print(f"[data] sample fallback: sample_data/sample.parquet -> {data_file}")
        return
    print(f"[data] WARNING: no dataset found. Place {data_file} in input_folder/.")


def download_libs():
    """Download UMD/IIFE assets. Already-cached files are skipped."""
    os.makedirs(APP_LIB_DIR, exist_ok=True)
    for name, url in ASSETS:
        target = os.path.join(APP_LIB_DIR, name)
        if os.path.exists(target):
            continue
        print(f"[libs] downloading {name}")
        try:
            urllib.request.urlretrieve(url, target)
        except Exception as e:
            print(f"[libs] FAILED to download {name} from {url}: {e}")
            sys.exit(1)


def prepare_dev_assets():
    """Public entry point — also called by build_app_package.py."""
    banner("trend_analytics_dashboard: preparing dev assets")
    resolve_dataset()
    download_libs()
    banner("Done — start the HTTP server with run_app.sh / run_app.bat")


def main():
    prepare_dev_assets()


if __name__ == "__main__":
    main()
