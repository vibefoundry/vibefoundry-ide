#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "========================================"
echo " Outlet Geo Dashboard Dev"
echo "========================================"
echo ""
echo "Preparing assets and starting Vite on http://127.0.0.1:5173"
echo "Press Ctrl+C to stop."
echo ""

[ -d node_modules ] || npm install
open http://127.0.0.1:5173 2>/dev/null || true
npm run dev
