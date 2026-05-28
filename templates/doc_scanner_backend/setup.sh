#!/bin/bash
# Run: bash app_folder/scripts/{app_name}/setup.sh
cd "$(dirname "$0")"

echo "========================================"
echo " Doc Scanner Agent Setup"
echo "========================================"

echo ""
echo "[1/1] Checking Python dependencies..."
if pip show openai > /dev/null 2>&1 && pip show watchdog > /dev/null 2>&1 && pip show pillow > /dev/null 2>&1; then
    echo "      Already installed, skipping."
else
    echo "      Installing Python dependencies..."
    pip install -r requirements.txt
fi

echo ""
echo "========================================"
echo " Setup complete! Run: bash $(dirname "$0")/run_app.sh"
echo "========================================"
