"""
Register or repair the local VibeFoundry bridge for Codex / ChatGPT desktop.

The public onboarding MCP at https://vibefoundry.ai/mcp installs the Python
runtime, then runs this module. From that point on, the local Python package owns
the heavy work and this command wires Codex to the tiny stdio bridge shipped in
``pane_mcp/index.js``.

Installed as the console command ``vibefoundry-setup-codex`` (see pyproject.toml).
Idempotent: re-running updates the skill and rewrites the VibeFoundry MCP block
if the package path changed after an upgrade.
"""

import os
import shutil
import re


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

    block = (
        "[mcp_servers.vibefoundry]\n"
        'command = "node"\n'
        f'args = ["{node_path}"]\n'
    )
    pattern = re.compile(
        r"(?ms)^\[mcp_servers\.vibefoundry\]\n"
        r"(?:^[^\[\n].*\n?)*"
    )
    if pattern.search(existing):
        updated = pattern.sub(block, existing, count=1)
        with open(cfg, "w", encoding="utf-8") as f:
            f.write(updated if updated.endswith("\n") else updated + "\n")
        print("Updated VibeFoundry pane MCP in ~/.codex/config.toml.")
        return 0

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
