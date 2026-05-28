"""
Stages parquet datasets for local dashboard_pwa_duckdb development.

For each dataset listed in src_app/data/app_config.json, copies the matching
parquet from input_folder/ into src_app/data/. If the file isn't in
input_folder/ but already exists in src_app/data/, it's left alone. If neither
exists, falls back to sample_data/ (template fallback only — never used in real
deployments).

Vite-less template — no npm, no esbuild. The browser libs in src_app/lib/ are
pre-bundled and committed to the template.
"""
import json
import os
import shutil
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(SCRIPT_DIR))))
INPUT_FOLDER = os.path.join(PROJECT_DIR, "input_folder")
APP_SOURCE_DIR = os.path.join(SCRIPT_DIR, "src_app")
DATA_DIR = os.path.join(APP_SOURCE_DIR, "data")
SAMPLE_DATA_DIR = os.path.join(SCRIPT_DIR, "sample_data")
CONFIG_PATH = os.path.join(DATA_DIR, "app_config.json")


def stage_dataset(file_name):
    target = os.path.join(DATA_DIR, file_name)
    input_src = os.path.join(INPUT_FOLDER, file_name)
    sample_src = os.path.join(SAMPLE_DATA_DIR, file_name)

    if os.path.exists(input_src):
        os.makedirs(DATA_DIR, exist_ok=True)
        shutil.copy2(input_src, target)
        print(f"[data] input_folder/{file_name} -> data/{file_name}")
        return "input"

    if os.path.exists(target) and os.path.getsize(target) > 0:
        print(f"[data] data/{file_name} already staged ({os.path.getsize(target):,} bytes).")
        return "existing"

    if os.path.exists(sample_src):
        os.makedirs(DATA_DIR, exist_ok=True)
        shutil.copy2(sample_src, target)
        print(f"[data] sample_data/{file_name} -> data/{file_name}  *** SAMPLE DATA ***")
        return "sample"

    raise SystemExit(
        f"[data] No parquet found for {file_name}. Provide one at:\n"
        f"  - {input_src}\n"
        f"  - {sample_src}\n"
    )


def prepare_dev_assets():
    if not os.path.exists(CONFIG_PATH):
        raise SystemExit(f"[config] {CONFIG_PATH} not found.")
    with open(CONFIG_PATH) as f:
        config = json.load(f)

    datasets = config.get("datasets")
    if not datasets:
        raise SystemExit("[config] app_config.json must contain a non-empty 'datasets' array.")

    seen = set()
    for ds in datasets:
        file_name = ds.get("file")
        if not file_name:
            raise SystemExit(f"[config] dataset entry is missing 'file': {ds}")
        if file_name in seen:
            continue
        seen.add(file_name)
        stage_dataset(file_name)


def main():
    prepare_dev_assets()


if __name__ == "__main__":
    main()
