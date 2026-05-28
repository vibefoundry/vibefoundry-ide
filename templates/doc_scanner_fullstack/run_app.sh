#!/bin/bash
# Run: bash app_folder/scripts/receipts_app/run_app.sh
cd "$(dirname "$0")"

# Use the vite binary as the install sentinel — `npm run dev` calls it directly,
# so its absence (missing OR half-installed node_modules/) means setup must run.
if [ ! -x "frontend/node_modules/.bin/vite" ]; then
    echo "Frontend deps missing or incomplete — running setup.sh..."
    bash "$(dirname "$0")/setup.sh" || { echo "Setup failed."; exit 1; }
fi

echo "========================================"
echo " Launching Receipts App"
echo "========================================"

# Reserve two free ports up front so frontend + backend agree on what's used.
export BACKEND_PORT=$(python3 -c "import socket; s=socket.socket(); s.bind(('127.0.0.1',0)); print(s.getsockname()[1]); s.close()")
export FRONTEND_PORT=$(python3 -c "import socket; s=socket.socket(); s.bind(('127.0.0.1',0)); print(s.getsockname()[1]); s.close()")

echo "Backend  : http://localhost:$BACKEND_PORT"
echo "Frontend : http://localhost:$FRONTEND_PORT"
cd frontend
npx concurrently -n "backend,frontend" -c "blue,green" \
    "cd .. && python backend/app.py" \
    "npm run dev"
