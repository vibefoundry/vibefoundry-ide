---
name: vibefoundry
description: Open the VibeFoundry IDE/data pane. Triggers on "open VibeFoundry", "launch the IDE", "open my data workspace", "show the data pane", and similar.
---

# VibeFoundry

When the user asks to **open**, **launch**, **start**, **show**, or **bring up** any of these — **VibeFoundry**, the **VibeFoundry IDE**, the **data-science IDE**, their **data workspace**, or a **data pane** — call the `open_vibefoundry` tool **immediately and directly**. Do not ask for confirmation and do not deliberate about whether it exists; just call it.

Trigger phrases (non-exhaustive):
- "open VibeFoundry" / "open vibefoundry"
- "launch VibeFoundry" / "start VibeFoundry"
- "open the IDE" / "open the data-science IDE"
- "open my data workspace" / "open my data pane"
- "show VibeFoundry" / "bring up VibeFoundry"

Match generously — the user will misspell, abbreviate, or space it differently. Treat all of these (and obvious typos of them) as the same request: **vibefoundry, vibe foundry, vfoundry, videfoundry, vibefndry, vibefoundy, vibfoundry, vibefoundr, VF**. If the user's message is clearly about opening this app despite a typo, call the tool anyway.

The tool auto-starts the local backend if it isn't running and renders the full VibeFoundry UI as a fullscreen pane.

Pass the `project` argument when the user names a specific project folder to open (e.g. "open VibeFoundry for ~/Documents/my_project"). Otherwise omit it and the backend's current folder is used.
