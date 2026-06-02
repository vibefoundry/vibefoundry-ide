#!/bin/bash
# Run: bash app_folder/scripts/data_chatbot_codex/run_app.sh
cd "$(dirname "$0")"

# Use the vite binary as the install sentinel — the launcher calls it directly,
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

# Skip a `codex login status` pre-flight here: on some machines that call hangs
# contacting the auth server (the .bat launcher skips it for the same reason).
# Auth errors surface in the app UI via the re-auth modal instead.

echo "========================================"
echo " Launching Data Chatbot"
echo "========================================"

# Reserve two free ports up front so frontend + backend agree on what's used.
# One interpreter start returns both (see backend/_pick_port.py).
read BACKEND_PORT FRONTEND_PORT < <(python3 backend/_pick_port.py)
export BACKEND_PORT FRONTEND_PORT

echo "Backend  : http://localhost:$BACKEND_PORT"
echo "Frontend : http://localhost:$FRONTEND_PORT"
cd frontend
# Launch backend + frontend together. Call the local concurrently and vite
# binaries directly: `npx` does a registry-resolution round-trip (it can stall
# or hang on slow/offline machines) even when the package is already installed,
# and invoking `vite` directly skips an extra `npm run dev` Node bootstrap.
exec node_modules/.bin/concurrently -n "backend,frontend" -c "blue,green" \
    "cd .. && python backend/app.py" \
    "node_modules/.bin/vite"
