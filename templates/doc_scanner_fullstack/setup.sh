#!/bin/bash
# Run: bash app_folder/scripts/receipts_app/setup.sh
cd "$(dirname "$0")"

echo "========================================"
echo " Receipts App Setup"
echo "========================================"

echo ""
echo "[1/3] Checking Python dependencies..."
if pip show flask > /dev/null 2>&1 && pip show openai > /dev/null 2>&1 && pip show polars > /dev/null 2>&1; then
    echo "      Already installed, skipping."
else
    echo "      Installing Python dependencies..."
    pip install -r backend/requirements.txt || { echo "ERROR: pip install failed"; exit 1; }
fi

echo ""
echo "[2/3] Checking Node dependencies..."
# The vite binary is the sentinel — `npm run dev` invokes it. A half-installed
# node_modules/ (missing .bin/vite) needs `npm install` to re-run.
if [ -x "frontend/node_modules/.bin/vite" ]; then
    echo "      Already installed, skipping."
else
    echo "      Installing Node dependencies (clean install)..."
    # Nuke any residue from a prior interrupted install — leftover files with
    # broken perms (EACCES on esbuild's postinstall, etc.) make `npm install`
    # over the top fail. Starting clean guarantees a fresh, consistent tree.
    rm -rf frontend/node_modules
    cd frontend
    npm install || { echo "ERROR: npm install failed"; exit 1; }
    cd ..
fi

echo ""
echo "[3/3] Checking concurrently..."
# Check the binary directly — `npx concurrently --version` can hang on Windows
# when npm contacts the registry, even with the package already installed.
if [ -x "frontend/node_modules/.bin/concurrently" ]; then
    echo "      Already installed, skipping."
else
    echo "      Installing concurrently..."
    cd frontend
    npm install concurrently --save-dev || { echo "ERROR: concurrently install failed"; exit 1; }
    cd ..
fi

echo ""
echo "========================================"
echo " Setup complete! Run: bash app_folder/scripts/receipts_app/run_app.sh"
echo "========================================"
