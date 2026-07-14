"""
Register the VibeFoundry pane MCP with the Codex / ChatGPT desktop app.

Adds a `[mcp_servers.vibefoundry]` stdio entry to ~/.codex/config.toml that
points `node` at the pane MCP shipped inside this package (pane_mcp/index.js).
The desktop app reads that file on startup, so after running this the user
restarts the app and can say "open VibeFoundry" to get the pane.

Installed as the console command `vibefoundry-setup-codex` (see pyproject.toml).
Idempotent: if the entry already exists it does nothing.
"""

import os


def main():
    pkg_dir = os.path.dirname(os.path.abspath(__file__))
    # Node accepts forward slashes on every OS, and they need no TOML escaping.
    node_path = os.path.join(pkg_dir, "pane_mcp", "index.js").replace("\\", "/")

    if not os.path.exists(node_path):
        print(f"Error: pane MCP not found at {node_path}")
        print("Reinstall vibefoundry: pip install --upgrade vibefoundry")
        return 1

    cfg_dir = os.path.expanduser(os.path.join("~", ".codex"))
    cfg = os.path.join(cfg_dir, "config.toml")
    os.makedirs(cfg_dir, exist_ok=True)

    existing = ""
    if os.path.exists(cfg):
        with open(cfg, "r", encoding="utf-8") as f:
            existing = f.read()

    if "[mcp_servers.vibefoundry]" in existing:
        print("VibeFoundry pane MCP is already registered in ~/.codex/config.toml.")
        print("Restart the ChatGPT / Codex desktop app, then say 'open VibeFoundry'.")
        return 0

    block = (
        "[mcp_servers.vibefoundry]\n"
        'command = "node"\n'
        f'args = ["{node_path}"]\n'
    )
    sep = "" if existing == "" or existing.endswith("\n") else "\n"
    with open(cfg, "a", encoding="utf-8") as f:
        f.write(sep + "\n" + block)

    print("Registered VibeFoundry pane MCP in ~/.codex/config.toml.")
    print("Now RESTART the ChatGPT / Codex desktop app, then say 'open VibeFoundry'.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
