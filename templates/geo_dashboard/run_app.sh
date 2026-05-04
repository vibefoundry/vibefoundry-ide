#!/bin/bash
# Mac/Linux dev launcher (plain-script, no npm, no Vite).
# Stages assets, then serves src_app/ via a Python HTTP server.
set -e
cd "$(dirname "$0")"

echo "========================================"
echo " Geo Dashboard Dev"
echo "========================================"
echo ""

python3 app_core/prepare_dev_assets.py
exec python3 app_core/serve_dev.py
