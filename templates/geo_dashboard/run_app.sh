#!/bin/bash
# Run: bash app_folder/templates/geo_dashboard/run_app.sh
set -e
cd "$(dirname "$0")"
APP_NAME="$(basename "$(pwd)")"

echo "[1/2] Building app package..."
python3 build_app_package.py

echo "[2/2] Launching..."
PROJECT_DIR="$(cd ../../.. && pwd)"
OUTPUT_PKG="$PROJECT_DIR/output_folder/$APP_NAME"
bash "$OUTPUT_PKG/mac_start.sh"
