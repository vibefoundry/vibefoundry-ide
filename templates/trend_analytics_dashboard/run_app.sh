#!/bin/bash
set -e
cd "$(dirname "$0")"

echo "========================================"
echo " Trend Analytics Dashboard Dev"
echo "========================================"
echo ""
echo "Preparing dev assets and starting Vite. Browser will open to whichever port Vite picks."
echo "Press Ctrl+C to stop."
echo ""

python3 app_core/prepare_dev_assets.py
cd app_core
npm run dev
