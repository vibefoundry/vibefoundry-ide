---
name: vibefoundry
description: Open the VibeFoundry IDE/data pane, and work through it afterwards. Triggers on "@vibefoundry", "@vf", "@vibefoundry launch", "open VibeFoundry", "launch the IDE", "open my data workspace", "show the data pane", and similar.
---

# VibeFoundry

When the user asks to **open**, **launch**, **start**, **show**, or **bring up** any of these — **VibeFoundry**, the **VibeFoundry IDE**, the **data-science IDE**, their **data workspace**, or a **data pane** — call the `open_vibefoundry` tool **immediately and directly**. Do not ask for confirmation and do not deliberate about whether it exists; just call it.

Trigger phrases (non-exhaustive):
- "@vibefoundry" / "@vf" / "@vibefoundry launch"
- "open VibeFoundry" / "open vibefoundry"
- "launch VibeFoundry" / "start VibeFoundry"
- "open the IDE" / "open the data-science IDE"
- "open my data workspace" / "open my data pane"
- "show VibeFoundry" / "bring up VibeFoundry"

Match generously — the user will misspell, abbreviate, or space it differently. Treat all of these (and obvious typos of them) as the same request: **vibefoundry, vibe foundry, vfoundry, videfoundry, vibefndry, vibefoundy, vibfoundry, vibefoundr, VF**. If the user's message is clearly about opening this app despite a typo, call the tool anyway.

The tool auto-starts the local backend if it isn't running and renders the full VibeFoundry UI as a fullscreen pane.

Pass the `project` argument when the user names a specific project folder to open (e.g. "open VibeFoundry for ~/Documents/my_project"). Otherwise omit it and the backend's current folder is used.

## After it's open — work through VibeFoundry

Once VibeFoundry is open, treat it as the user's working environment for the rest of the conversation. Their data and code live in the project folder, and this server is how you reach both.

- **Any question about their data** — what exists, what's in it, which file to use, which column holds what — call **`vf_catalog` first**. It returns each dataset's description, what one row represents, row counts, and column profiles (distinct values for categoricals, min/max/mean for continuous, real date ranges for temporal). Use `dataset: "<name>"` for one dataset's full profile.
- **Never guess** at filenames, columns or contents, and never answer from memory. If the catalogue is empty, say so and point the user at the Data Catalogue tab — don't invent an answer.
- **`vf_request`** reaches any backend endpoint (files, previews, running scripts) when no dedicated tool fits.
- **Follow the project's `AGENTS.md`** for structure: `input_folder/` is source data and is never edited, results go to `output_folder/{task}/`, and all code lives in `app_folder/scripts/{app}/`.
