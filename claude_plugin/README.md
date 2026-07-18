# VibeFoundry Codex plugin bridge

This directory contains the local Codex bridge used by the VibeFoundry Python runtime. It is intentionally thin: it launches the pane, starts the installed Python backend, and proxies pane/backend requests.

The public onboarding surface is the Streamable HTTP MCP at:

```text
https://vibefoundry.ai/mcp
```

That hosted MCP returns the exact install/scaffold commands. The installer installs or upgrades the `vibefoundry` Python package and finishes by running:

```text
python -m vibefoundry.setup_codex
```

That command registers this local bridge in `~/.codex/config.toml`.

The local bridge exposes:

- `open_vibefoundry`
- `vf_request`
- `vf_catalog`
- `scaffold_project`
- `setup_vibefoundry`

`$vibefoundry` opens the IDE directly. `$installmcp` remains as a compatibility workflow for Git/local installs, but the preferred public install path is the hosted MCP.

## Local testing

Add this directory as a local marketplace root, install `vibefoundry@vibefoundry` in Codex, and start a new task so the skills and MCP tools are reloaded.

## Public distribution

For public/official distribution, point users or marketplace review at the hosted MCP URL. It is the stable entrypoint and does not require shipping this repo's local stdio bundle as the primary marketplace artifact.

## Git marketplace distribution

The `codex-plugin` branch can still be registered directly as a Git-backed marketplace for testing the local bridge. Its root `.agents/plugins/marketplace.json` points to this folder's plugin payload. Use both sparse paths so Codex checks out the root manifest and the plugin:

```text
codex plugin marketplace add https://github.com/vibefoundry/vibefoundry-ide.git --ref codex-plugin --sparse .agents/plugins --sparse codex_plugin
codex plugin add vibefoundry@vibefoundry
```

A `codex://plugins/install/?marketplace=vibefoundry` link works only after Codex already knows the `vibefoundry` marketplace. Codex does not document a deep link that silently registers an arbitrary hosted `marketplace.json` URL.
