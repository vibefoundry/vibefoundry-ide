---
name: installmcp
description: Set up the local VibeFoundry runtime and scaffold the current project. Trigger explicitly with "$installmcp" and for requests to install or configure VibeFoundry for Codex.
---

# Install VibeFoundry

Set up VibeFoundry from inside Codex. Do not send the user to a separate terminal and do not register the hosted `https://vibefoundry.ai/mcp` endpoint; this plugin already provides the MCP server locally.

1. Detect the operating system. On macOS, `uname -s` returns `Darwin`. On Windows, PowerShell exposes `$env:OS` as `Windows_NT`.
2. Call `setup_vibefoundry` with `os` set to `mac` or `windows`.
3. Run only the commands returned by the tool, in order. Ask for Codex approval when a native installer or a command outside the sandbox requires it. Keep the user informed as each numbered setup step runs.
4. Call `scaffold_project` with `projectRoot` set to the current Codex task's absolute working directory. Never ask the user to type the path.
5. Read the resulting root `AGENTS.md` completely and follow it for all project work.
6. Call `open_vibefoundry` with the same `projectRoot`.

If setup fails, retry or diagnose only the failing command. Do not substitute unrelated installers, editors, package managers, or toolchains.
