---
name: vibefoundry
description: Open the VibeFoundry IDE/data pane, and work through it afterwards. Triggers on "$vibefoundry", "@vibefoundry", "@vf", "@vibefoundry launch", "open VibeFoundry", "launch the IDE", "open my data workspace", "show the data pane", and similar.
---

# VibeFoundry

When the user asks to **open**, **launch**, **start**, **show**, or **bring up** any of these — **VibeFoundry**, the **VibeFoundry IDE**, the **data-science IDE**, their **data workspace**, or a **data pane** — call the `open_vibefoundry` tool **immediately and directly**. Do not ask for confirmation and do not deliberate about whether it exists; just call it.

Trigger phrases (non-exhaustive):
- "@vibefoundry" / "@vf" / "@vibefoundry launch"
- "$vibefoundry"
- "open VibeFoundry" / "open vibefoundry"
- "launch VibeFoundry" / "start VibeFoundry"
- "open the IDE" / "open the data-science IDE"
- "open my data workspace" / "open my data pane"
- "show VibeFoundry" / "bring up VibeFoundry"

Match generously — the user will misspell, abbreviate, or space it differently. Treat all of these (and obvious typos of them) as the same request: **vibefoundry, vibe foundry, vfoundry, videfoundry, vibefndry, vibefoundy, vibfoundry, vibefoundr, VF**. If the user's message is clearly about opening this app despite a typo, call the tool anyway.

Call `open_vibefoundry` with `projectRoot` set to the current Codex task's absolute working directory. Get this from the task context automatically; never ask the user to type or select it. The tool starts a fresh local backend rooted there and renders the full VibeFoundry UI as a fullscreen pane. Never infer the project from the MCP server process's working directory and never substitute a different folder.

## After it's open — work through VibeFoundry

Once VibeFoundry is open, treat it as the user's working environment for the rest of the conversation. Their data and code live in the project folder, and this server is how you reach both.

`vf_request` reaches any backend endpoint (files, previews, running scripts) when no dedicated tool fits.

### Data questions: local first, then the catalogue

**1. Look in the project's own data first.** Read `app_folder/meta_data/input_metadata.txt` via `vf_request` — it's a generated digest of every file in `input_folder/` with columns, row counts and date columns. List `input_folder/` with `/api/files/tree`. If the answer is there, use it; the data is already local and needs no pulling.

**2. If `input_folder/` can't answer it, assume the answer is in the Data Catalogue.** That means: no such dataset locally, missing columns, wrong time period, or the digest says *"No data files found"*. Call **`vf_catalog`** to search the connected SharePoint library — it returns each dataset's description, what one row represents (the grain), row counts, and column profiles (distinct values for categoricals, min/max/mean for continuous, real date ranges for temporal). Use `dataset: "<name>"` for one dataset's full column profile.

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
