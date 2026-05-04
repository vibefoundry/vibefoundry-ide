#!/usr/bin/env bash
# One-time Codex CLI setup for VibeFoundry projects (macOS / Linux).
#
# Marks the workspace as trusted so Codex auto-approves the routine
# work that happens inside the project directory:
#
#   AUTO-APPROVED (anything within the workspace):
#     - File exploration:   ls, find, Get-ChildItem, cat, grep, Select-String
#     - File creation/edit: mkdir, touch, cp, mv, rm, New-Item, Copy-Item, Remove-Item
#     - Python:             python script.py, PYTHONUTF8=1 python …,
#                           PYTHONIOENCODING=utf-8 …, pip install, python -m venv
#     - Git:                git add, git commit, git status, git diff, git log
#     - Node/npm:           npm install, npm run build, npm run dev, node …
#     - Data frame ops:     Polars, pandas, DuckDB — anything in-process
#
#   STILL REQUIRES APPROVAL (boundary cases):
#     - Operations that leave the workspace directory (writes to ~/, /etc, etc.)
#     - File transfers out of the project (scp, curl uploads, rsync to remote)
#     - Plans for multi-step builds (agent-side, governed by AGENTS.md)
#     - Judgment-call questions (e.g., "is this a new task or a continuation?")
#
# Equivalent to clicking "Trust workspace" in VS Code / Cursor / Codespaces.
#
# Run once:   bash app_folder/templates/setup_codex.sh
# Re-run anytime — it's idempotent and backs up your existing config.

set -e

CONFIG_DIR="$HOME/.codex"
CONFIG_FILE="$CONFIG_DIR/config.toml"
BACKUP_FILE="$CONFIG_DIR/config.toml.bak"

mkdir -p "$CONFIG_DIR"

if [ -f "$CONFIG_FILE" ]; then
    cp "$CONFIG_FILE" "$BACKUP_FILE"
    echo "Backed up existing config to $BACKUP_FILE"
else
    touch "$CONFIG_FILE"
fi

set_or_append() {
    local key="$1"
    local value="$2"
    if grep -q "^${key}" "$CONFIG_FILE"; then
        if sed -i "s|^${key}.*|${key} = \"${value}\"|" "$CONFIG_FILE" 2>/dev/null; then :
        else sed -i '' "s|^${key}.*|${key} = \"${value}\"|" "$CONFIG_FILE"
        fi
    else
        echo "${key} = \"${value}\"" >> "$CONFIG_FILE"
    fi
}

if ! grep -q "Workspace is trusted" "$CONFIG_FILE"; then
    {
        echo ""
        echo "# Workspace is trusted — set by setup_codex.sh"
    } >> "$CONFIG_FILE"
fi

set_or_append "approval_policy" "never"
set_or_append "sandbox_mode" "workspace-write"

echo ""
echo "Codex configured for trusted-workspace mode."
echo "   Settings written to: $CONFIG_FILE"
echo "   Backup at:           $BACKUP_FILE"
echo "   Restart Codex if it's running."
