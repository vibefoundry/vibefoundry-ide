#!/bin/bash
# Run: bash app_folder/scripts/data_chatbot_codex/run_app.sh
cd "$(dirname "$0")"

# Use the vite binary as the install sentinel — `npm run dev` calls it directly,
# so its absence (missing OR half-installed node_modules/) means setup must run.
if [ ! -x "frontend/node_modules/.bin/vite" ]; then
    echo "Frontend deps missing or incomplete — running setup.sh..."
    bash "$(dirname "$0")/setup.sh" || { echo "Setup failed."; exit 1; }
fi

# Re-check codex is on PATH even if setup didn't run this launch (a user could
# uninstall codex between launches and we'd otherwise only notice at the first
# /api/ask). Fast: one `command -v`.
if ! command -v codex > /dev/null 2>&1; then
    echo "ERROR: codex CLI not found on PATH."
    echo "Install OpenAI Codex CLI and try again."
    exit 1
fi

# Verify codex is authenticated. Exit code is 0 when logged in, non-zero when
# missing/expired — in which case we run `codex login` interactively so the
# browser-OAuth happens before the backend starts (Flask has no TTY, so a 401
# mid-request would be unrecoverable from the UI).
if ! codex login status > /dev/null 2>&1; then
    echo "Codex not logged in — opening browser for OAuth..."
    codex login || { echo "ERROR: codex login failed."; exit 1; }
fi

echo "========================================"
echo " Launching Data Chatbot"
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
