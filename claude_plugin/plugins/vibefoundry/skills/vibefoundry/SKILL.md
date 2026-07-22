---
name: vibefoundry
description: Open the VibeFoundry IDE as an in-app pane in Claude Code, and work through it afterwards. Triggers on "$vibefoundry", "@vibefoundry", "@vf", "@vibefoundry launch", "open VibeFoundry", "launch the IDE", "open my data workspace", "show the data pane", and similar.
---

# VibeFoundry

When the user asks to **open**, **launch**, **start**, **show**, or **bring up** any of these — **VibeFoundry**, the **VibeFoundry IDE**, the **data-science IDE**, their **data workspace**, or a **data pane** — run the **launch sequence below immediately and directly**. Do not ask for confirmation and do not deliberate about whether it exists; just do it.

Trigger phrases (non-exhaustive): `@vibefoundry`, `@vf`, `@vibefoundry launch`, `$vibefoundry`, "open VibeFoundry", "launch VibeFoundry", "start VibeFoundry", "open the IDE", "open the data-science IDE", "open my data workspace", "show VibeFoundry", "bring up VibeFoundry". Match generously through misspellings/abbreviations: **vibefoundry, vibe foundry, vfoundry, videfoundry, vibefoundy, vibfoundry, VF**.

The goal: end with the VibeFoundry IDE rendered inside Claude Code's **Preview pane**, opened on the user's current project.

## Launch sequence

The heavy lifting is done in code by `open_vibefoundry`: it starts the backend on a fresh port **and** deterministically writes a uniquely-named, per-conversation config into `<CWD>/.claude/launch.json` (`vibefoundry-<port>`), preserving every other entry and pruning only its own dead ports. So you never compute a port, name a config, or edit `launch.json` yourself — just call the tool and use what it returns.

**1. Start the backend + register the pane config.**
Call `open_vibefoundry` with `projectRoot` set to the **absolute path of the current working directory** — the folder the user is working in this session. Get this from session/task context automatically; never ask the user to type or select it, and never infer it from the MCP server process's own working directory. From the result's `structuredContent`, read two values:
- `backendUrl` (e.g. `http://127.0.0.1:<port>`) — call it `<URL>`; hand it to the user at the end.
- `previewConfigName` (e.g. `vibefoundry-64783`) — the launch config the tool just wrote. Use it verbatim in the next step; do not construct or guess it.

**2. Open the Preview pane — only ever touch YOUR OWN config.**
Call `preview_start` with `name: previewConfigName`. Because that name is unique to the backend just started, it mounts the pane on exactly this session's backend — not a stale one from another conversation. Then `preview_screenshot` (or `preview_snapshot`) with the returned `serverId` to check state.

**Never** `preview_stop` a `vibefoundry-*` server you did not start this turn: `preview_list` only shows *this* conversation's servers, so you cannot see another conversation's pane and must not assume you can safely stop it. For a clean restart, stop/start **only** `previewConfigName`.

**3. Open the project in the pane (only if the folder picker is showing).**
If the UI shows the "Select Project Folder" picker instead of the file tree:
- Fill the path box with `<CWD>` using `preview_fill` on selector `input[type="text"]`.
- Click **Go**, then **Select This Folder**, using `preview_eval`:
  - `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Go').click()`
  - then `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Select This Folder').click()`
- Screenshot to confirm the project's file tree is now showing.

**4. Confirm.** Tell the user VibeFoundry is open in the Preview pane on their project, and include `<URL>` in case they also want a full browser tab.

**Fallback:** if the Preview tools are unavailable (e.g. terminal Claude Code with no Preview panel), skip steps 2–3 and just give the user `<URL>` to open in a browser or paste into the app's built-in "Enter a URL" pane.

## After it's open — work through VibeFoundry

Once VibeFoundry is open, treat it as the user's working environment for the rest of the conversation: their data and code live in the project folder, and this server is how you reach both. `vf_request` reaches any backend endpoint (files, previews, running scripts) when no dedicated tool fits.

The full working rules — **data questions go local-first (`input_folder/` digest) then the Data Catalogue (`vf_catalog`, pull before analysing), never invent values; building apps follows the project's `AGENTS.md` and starts from a template, never from scratch** — are delivered at runtime in two places that stay in sync with the server: the MCP server's `initialize` instructions, and the live brief `open_vibefoundry` returns (which reports this project's actual `input_folder`/`templates`/`AGENTS.md` state). Follow those; they supersede any static copy here.
