#!/bin/bash
# Run: bash app_folder/scripts/data_chatbot_codex/clear_cache.sh
cd "$(dirname "$0")"

echo "========================================"
echo " Clearing Cache"
echo "========================================"

echo "Removing node_modules..."
rm -rf frontend/node_modules

echo "Removing __pycache__..."
find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null

echo "Removing build artifacts..."
rm -rf frontend/build frontend/dist

echo ""
echo "Cache cleared. Running setup..."
echo ""
bash "$(dirname "$0")/setup.sh"
