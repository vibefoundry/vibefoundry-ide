---
name: vibefoundry
description: Open the VibeFoundry IDE as an in-app pane in Claude Code, and work through it afterwards. Triggers on "$vibefoundry", "@vibefoundry", "@vf", "@vibefoundry launch", "open VibeFoundry", "launch the IDE", "open my data workspace", "show the data pane", and similar.
---

# VibeFoundry

When the user asks to **open**, **launch**, **start**, **show**, or **bring up** any of these — **VibeFoundry**, the **VibeFoundry IDE**, the **data-science IDE**, their **data workspace**, or a **data pane** — run the **launch sequence below immediately and directly**. Do not ask for confirmation and do not deliberate about whether it exists; just do it.

Trigger phrases (non-exhaustive): `@vibefoundry`, `@vf`, `@vibefoundry launch`, `$vibefoundry`, "open VibeFoundry", "launch VibeFoundry", "start VibeFoundry", "open the IDE", "open the data-science IDE", "open my data workspace", "show VibeFoundry", "bring up VibeFoundry". Match generously through misspellings/abbreviations: **vibefoundry, vibe foundry, vfoundry, videfoundry, vibefoundy, vibfoundry, VF**.

The goal: end with the VibeFoundry IDE rendered inside Claude Code's **Preview pane**, opened on the user's current project.

## Launch sequence

**1. Start the backend.**
Call `open_vibefoundry` with `projectRoot` set to the **absolute path of the current working directory** — the folder the user is working in this session. Get this from the session/task context automatically; never ask the user to type or select it, and never infer it from the MCP server process's own working directory. From the result's `structuredContent`, read `backendUrl` (e.g. `http://127.0.0.1:<port>`). Call the value `<URL>`, its port `<PORT>`, and the working directory `<CWD>`. The backend uses a **dynamic port**, so always take `<PORT>` from `<URL>` — do not hardcode it.

**2. Ensure a Preview launch config exists.**
Claude Code's Preview pane launches servers defined in `<CWD>/.claude/launch.json`. Write (or update) that file so it contains a configuration named `vibefoundry` on `<PORT>`, preserving any existing configurations:
```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "vibefoundry",
      "runtimeExecutable": "vibefoundry",
      "runtimeArgs": ["--port", "<PORT>", "--no-browser", "--pane", "<CWD>"],
      "port": <PORT>
    }
  ]
}
```

**3. Open the Preview pane.**
Call `preview_start` with `name: "vibefoundry"`. It reuses the backend already running on `<PORT>` and opens the internal Preview pane. Then take a `preview_screenshot` (or `preview_snapshot`) with the returned `serverId` to check the state.

**4. Open the project in the pane (only if the folder picker is showing).**
If the UI shows the "Select Project Folder" picker instead of the file tree:
- Fill the path box with `<CWD>` using `preview_fill` on selector `input[type="text"]`.
- Click **Go**, then **Select This Folder**, using `preview_eval`:
  - `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Go').click()`
  - then `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Select This Folder').click()`
- Screenshot to confirm the project's file tree is now showing.

**5. Confirm.** Tell the user VibeFoundry is open in the Preview pane on their project, and include `<URL>` in case they also want to open it in a full browser.

**Fallback:** if the Preview tools are unavailable (e.g. terminal Claude Code with no Preview panel), skip steps 2–4 and just give the user `<URL>` to open in a browser or paste into the app's built-in "Enter a URL" pane.

## After it's open — work through VibeFoundry

Once VibeFoundry is open, treat it as the user's working environment for the rest of the conversation. Their data and code live in the project folder, and this server is how you reach both. `vf_request` reaches any backend endpoint (files, previews, running scripts) when no dedicated tool fits.

### Data questions: local first, then the catalogue

**1. Look in the project's own data first.** Read `app_folder/meta_data/input_metadata.txt` via `vf_request` — a generated digest of every file in `input_folder/` with columns, row counts and date columns. List `input_folder/` with `/api/files/tree`. If the answer is there, use it; the data is already local and needs no pulling.

**2. If `input_folder/` can't answer it, assume the answer is in the Data Catalogue.** That means: no such dataset locally, missing columns, wrong time period, or the digest says *"No data files found"*. Call **`vf_catalog`** to search the connected SharePoint library — it returns each dataset's description, what one row represents (the grain), row counts, and column profiles. Use `dataset: "<name>"` for one dataset's full column profile.

**3. Pull before analysing.** Once you've picked a dataset:

```
vf_request POST /api/sharepoint/download
  { serverRelativeUrl: "<catalogue folder>/<path>", destFolder: "input_folder" }
```

**Never invent** filenames, columns or values at any step, and never answer from memory. If neither local data nor the catalogue can answer, say so and point the user at the Data Catalogue tab.

### Building an app: AGENTS.md, and never from scratch

- **Read the project's `AGENTS.md` first and follow it exactly** — the track choice, folder structure, `run_app.sh`/`.bat`, and "input is sacred". Never stray from it or invent your own structure.
- **Always look for an existing template first.** List the project's `templates/` folder (`vf_request /api/files/tree`). If one fits, start from it.
- **If `templates/` has nothing suitable, pull one from the VibeFoundry template library** rather than starting from scratch:

```
vf_request GET  /api/templates/catalog          # what's available
vf_request POST /api/templates/download {id}    # lands in templates/
```

- Only write an app from scratch if the library genuinely has nothing close.
