# `publish.py` — what it does

`publish.py` turns this template (a Flask + React codex chatbot that normally runs
from source via `setup.sh`/`run_app.sh`) into a **distributable desktop app** that a
non-technical end user can install and run with no prior toolchain.

It is the heavier cousin of the DuckDB template's `build_app_package.py`. That app is
static files + WASM, so "publishing" is just copying files. This app *computes* — it
needs a Python runtime, pinned dependencies, a built frontend, and the codex CLI — so
`publish.py` has to snapshot a reproducible runtime and emit a self-installing package.

> Status: **spec / not yet implemented.** This document is the agreed design for
> `publish.py`. Build against it.

---

## How you run it

```
python publish.py "My App Name"
```

- The **app name comes from the user** (CLI arg, or an interactive prompt if omitted).
- That single name drives: the output folder slug, the conda env name (sanitized),
  the Desktop shortcut label, and the app's browser-tab/window title.

Runs on the **developer's machine** (macOS, with Python + Node + internet). The output
is consumed by **end users who have nothing installed**.

---

## What it produces

A single versioned package next to `publish.py`: **one shared core + one installer per OS.**

```
published_apps/<app-slug>_v{N}/        # auto-increments; never overwrites a prior version
├── install.bat               # Windows — user runs once
├── install.command           # macOS — user runs once
└── application_core/
    ├── backend/              # .py + requirements.lock.txt + schemas + instructions.json
    ├── frontend_dist/        # pre-built static UI (Flask serves this; no Node at runtime)
    ├── data/                 # staged parquet datasets
    ├── wheels/
    │   ├── win_amd64/        # vendored Windows wheels (offline, exact versions)
    │   └── macosx_arm64/     # vendored Apple Silicon wheels
    ├── run_app.bat           # launcher the Desktop shortcut points to
    ├── run_app.command
    ├── <app>.ico             # Windows shortcut icon (from templates/vf_logo.png)
    └── <app>.icns            # macOS launcher icon
```

`<app-slug>` is the sanitized app name; `{N}` is one past the highest existing version
(same scheme as the dashboard template's `published_apps/dashboard_v{N}`). The user runs
the one installer for their OS; both share `application_core/`, and each installer picks
its own platform from `wheels/`.

The branded Desktop launchers (Windows `.lnk`, macOS `.app`) are **not shipped** — the
installer **generates them locally** on the user's machine (see Security warnings for why
that matters).

---

## Runtime stack (the design decisions)

- **Toolchain: Miniforge** (conda) installed to the user's home (`~/miniforge3`).
  One install provides **Python + Node + Git**. We use Miniforge — not an embeddable
  Python in the app folder — specifically because **codex requires Node** (`npm install
  -g @openai/codex`), which embeddable Python cannot provide. The toolchain is shared
  and reused across all published apps.
- **App dependencies: vendored wheels.** Pinned, downloaded at publish time, installed
  offline into a **dedicated conda env per app** (`pip install --no-index`). This is
  where exact versions live. Deterministic and immune to PyPI/proxy issues.
- **Frontend: pre-built.** `vite build` produces static assets that Flask serves
  same-origin. No Vite dev server, no `concurrently`, no Node *at runtime* (Node is only
  needed once, to install codex).
- **Credentials: per-user codex login.** No API key is baked into the package. The
  app's existing browser-OAuth modal (`/api/auth/codex/login`) handles login on the
  first question; the credential stays in the user's own `~/.codex`.

---

## The end-user experience

1. Double-click **`install.bat`** (Windows) or **`install.command`** (macOS) once. It
   runs the steps below, skipping anything already installed (idempotent), then
   **generates a branded launcher on the Desktop**.
2. Click the **Desktop icon** → Flask starts on a free port, serves the built UI, opens
   the browser.
3. Ask the first question → if codex isn't logged in, the app's modal opens the browser
   to OpenAI's OAuth page. After that, it just works.

### Install steps (uses the org-approved install commands)

| Step | Skipped if… | Command |
|------|-------------|---------|
| 1. Miniforge | `~/miniforge3` conda exists | curl + silent install |
| 2. Node + Git | conda lists nodejs/git | `conda install -y nodejs git` |
| 3. codex CLI | `codex` on PATH | `npm install -g @openai/codex` |
| 4. App env | conda env `<app-slug>` exists | `conda create` + `pip install --no-index --find-links wheels/<platform>` |
| 5. Launcher | (always) | generate branded Desktop launcher locally (`.lnk` / `.app`) |

**PATH caveats the scripts must handle:**
- **Windows:** after Miniforge installs with `/AddToPath=1`, the current `cmd` session
  can't see `conda` yet — call it by full path (`%USERPROFILE%\miniforge3\condabin\conda.bat`).
- **Mac:** `conda init zsh` only affects new shells — `source ~/miniforge3/etc/profile.d/conda.sh && conda activate <app-slug>` instead of relying on a fresh login.

---

## What `publish.py` does, stage by stage

1. **Pin** — build an isolated env, install declared deps, `pip freeze` →
   `requirements.lock.txt` (top-level + transitive). Record Python/Node target versions.
   The frontend is already pinned by `package-lock.json` (+ `npm ci`).
2. **Vendor** — `pip download` the pinned reqs **twice**: `--platform win_amd64` and
   `--platform macosx_arm64` (`--only-binary=:all:`) into each OS folder's `wheels/`.
3. **Build frontend** — `npm ci` + `vite build`, configured same-origin (relative
   `/api`, no proxy, no concurrently).
4. **Assemble** — copy backend, built frontend, staged `data/`, and both platforms'
   wheels into a single `application_core/`.
5. **Icons** — `templates/vf_logo.png` → `.ico` (Pillow) and `.icns` (`sips`); pad the
   non-square source to a square canvas first.
6. **Emit installers + launchers** — write `install.bat` / `install.command` at the
   package root and `run_app.bat` / `run_app.command` inside `application_core/`. The
   installers contain the logic to generate the branded Desktop launcher locally.

---

## Security warnings (be honest with users)

The toolchain installers (Miniforge, Node) are officially signed — fine. The only
unsigned artifact the user downloads is **our installer** (`install.bat` /
`install.command`). The key design point:

> OS guards (SmartScreen / Gatekeeper) only fire on files carrying a "downloaded from
> elsewhere" tag (Mark-of-the-Web / `com.apple.quarantine`), applied by the *downloader*.
> A launcher **created locally by the installer** is born without that tag — so it does
> **not** warn.

So the friction is **one prompt, ever** — the installer itself:

- **Windows:** `install.bat` is a script, not a frozen PyInstaller `.exe`, so it avoids
  the AV false-positive problem and gets at most a mild SmartScreen prompt once. The
  `.lnk` it creates locally is clean.
- **macOS:** the downloaded `install.command` triggers Gatekeeper once —
  *"can't be opened because Apple cannot check it for malicious software"* → user does
  **right-click → Open** a single time. The branded `.app` the installer then generates
  on the Desktop is **created locally → unquarantined → launches with no warning** every
  day after.

**Zero-friction fixes** (optional, later): Apple Developer ID signing + notarization on
Mac; an EV code-signing cert on Windows; or org IT/MDM allowlisting on both.

---

## Assumptions / limitations

- **macOS target: Apple Silicon (`arm64`) only.** Intel Macs would need the `x86_64`
  Miniforge + `macosx_x86_64` wheels.
- This template is **codex-specific** (`npm install -g @openai/codex`). Each user needs
  their own OpenAI/codex access.
- The published app **phones out** to OpenAI via codex at runtime; it is not offline.
- The package ships a full runtime → **larger on disk** than a from-source clone.
