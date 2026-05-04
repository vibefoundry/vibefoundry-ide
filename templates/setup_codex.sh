#!/usr/bin/env bash
# One-time Codex CLI setup for VibeFoundry projects (macOS / Linux).
#
# Marks the workspace as trusted so Codex can run shell commands and
# edit files inside the project without prompting for approval on
# every command. The agent still pauses for plans and judgment-call
# questions — those are governed by AGENTS.md, not this config.
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
