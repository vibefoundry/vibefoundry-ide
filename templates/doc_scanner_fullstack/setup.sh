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
    pip install -r backend/requirements.txt
fi

echo ""
echo "[2/3] Checking Node dependencies..."
# The vite binary is the sentinel — `npm run dev` invokes it. A half-installed
# node_modules/ (missing .bin/vite) needs `npm install` to re-run.
if [ -x "frontend/node_modules/.bin/vite" ]; then
    echo "      Already installed, skipping."
else
    echo "      Installing Node dependencies..."
    cd frontend
    npm install
    cd ..
fi

echo ""
echo "[3/3] Checking concurrently..."
if npx concurrently --version > /dev/null 2>&1; then
    echo "      Already installed, skipping."
else
    echo "      Installing concurrently..."
    cd frontend
    npm install concurrently --save-dev
    cd ..
fi

echo ""
echo "========================================"
echo " Setup complete! Run: bash app_folder/scripts/receipts_app/run_app.sh"
echo "========================================"
