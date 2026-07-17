"""
Register the VibeFoundry pane MCP and skill with the Codex / ChatGPT desktop app.

Adds a `[mcp_servers.vibefoundry]` stdio entry to ~/.codex/config.toml that
points `node` at the pane MCP shipped inside this package (pane_mcp/index.js).
Also installs a user-wide `vibefoundry` skill into ~/.agents/skills so the user
can invoke it directly with `$vibefoundry`.

Installed as the console command `vibefoundry-setup-codex` (see pyproject.toml).
Idempotent: re-running updates the skill and leaves existing MCP config in place.
"""

import os
import shutil


def _install_skill(pkg_dir):
    src = os.path.join(pkg_dir, "codex_skill", "vibefoundry", "SKILL.md")
    if not os.path.exists(src):
        print(f"Error: VibeFoundry skill not found at {src}")
        print("Reinstall vibefoundry: pip install --upgrade vibefoundry")
        return 1

    skill_dir = os.path.expanduser(os.path.join("~", ".agents", "skills", "vibefoundry"))
    os.makedirs(skill_dir, exist_ok=True)
    shutil.copyfile(src, os.path.join(skill_dir, "SKILL.md"))
    print("Installed VibeFoundry skill at ~/.agents/skills/vibefoundry/SKILL.md.")
    return 0


def _register_mcp(pkg_dir):
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
    return 0


def main():
    pkg_dir = os.path.dirname(os.path.abspath(__file__))
    skill_status = _install_skill(pkg_dir)
    mcp_status = _register_mcp(pkg_dir)
    if skill_status or mcp_status:
        return 1
    print("Restart the ChatGPT / Codex desktop app, then use '$vibefoundry'.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
