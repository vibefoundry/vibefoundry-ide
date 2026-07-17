# VibeFoundry Codex plugin

This directory is the complete VibeFoundry marketplace root. Its catalog is at `.agents/plugins/marketplace.json`, and the installable plugin is under `plugins/vibefoundry`. The plugin contains the local stdio MCP server, pane assets, skills, and canonical project rulebook.

The plugin does not connect to `https://vibefoundry.ai/mcp`. Its five tools run through one local MCP process:

- `open_vibefoundry`
- `vf_request`
- `vf_catalog`
- `scaffold_project`
- `setup_vibefoundry`

`$installmcp` sets up the VibeFoundry runtime, scaffolds the current project, and opens the IDE. `$vibefoundry` opens the IDE directly.

## Local testing

Add this directory as a local marketplace root, install `vibefoundry@vibefoundry` in Codex, and start a new task so the skills and MCP tools are reloaded.

## Distribution without a terminal

The supported recipient flow is Codex plugin sharing:

1. The publisher installs this local plugin in the ChatGPT desktop app.
2. In **Plugins**, open **Created by you**, choose VibeFoundry, and select **Share**.
3. Add workspace members or copy the generated share link.
4. Recipients open the link or install VibeFoundry from **Shared with you** and confirm in Codex.

Recipients do not run terminal commands or an OS installer to install the plugin. The optional `$installmcp` workflow may still request normal Codex approval when it installs the local Python runtime needed by the VibeFoundry backend.

## Git marketplace distribution

This folder can also be used as a Git-backed marketplace for developer or managed rollout. Codex supports Git repository marketplace sources and sparse paths; the marketplace entry itself remains local and resolves `./plugins/vibefoundry` relative to this directory.

A `codex://plugins/install/?marketplace=vibefoundry` link works only after Codex already knows the `vibefoundry` marketplace. Codex does not document a deep link that silently registers an arbitrary hosted `marketplace.json` URL.
