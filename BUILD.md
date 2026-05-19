# Building & Releasing VibeFoundry IDE

How the IDE is built, what caches exist, and how to ship a new version.
Read this before publishing — the bare `npm run build` is **not** the full
release process.

## How the package is structured

The pip package ships a **pre-built** copy of the frontend. There is no build
step on the user's machine.

```
frontend/                     React app (source)
  └── npm run build  ──▶  src/vibefoundry/static/   (compiled bundle)
pyproject.toml                includes static/**/* as package data
```

Consequence:

- A **frontend change** (anything under `frontend/src/`) does **not** reach
  users until the static bundle is rebuilt.
- A **backend-only change** (anything under `src/vibefoundry/*.py`) reaches
  users on the next package build with no frontend rebuild needed.

## Caches — what exists and what actually matters

| Cache | Location | Cleared by | Must clear manually? |
|---|---|---|---|
| Frontend static bundle | `src/vibefoundry/static/` | Vite `emptyOutDir: true` — auto-wiped on every `npm run build` | No — self-clearing |
| Python build artifacts | `dist/`, `build/`, `src/vibefoundry.egg-info/` | `rm -rf` (done by `publish.sh` and `make clean`) | **Yes** — stale artifacts re-ship old metadata or an old wheel |
| Vite dependency cache | `frontend/node_modules/.vite/` | `rm -rf frontend/node_modules/.vite` | Only if you hit stale-module weirdness |
| Service worker | `sw.js`, cached in users' browsers | SW update on next load | Runtime concern — see below |

Key point: `vite build` already empties `src/vibefoundry/static/` itself
(`emptyOutDir: true` in `vite.config.js`), so the static dir is self-clearing.
The artifacts that genuinely need a manual wipe are the **Python** ones —
`dist/`, `build/`, `egg-info/` — because a stale `dist/` can cause `twine` to
upload an old wheel.

## Dev workflow (local, no publish)

```bash
make dev
```

Runs the Vite dev server (`http://localhost:5173`) and the backend
(`http://localhost:8765`) together. The dev server proxies `/api` and `/ws`
to the backend, so frontend changes hot-reload without touching the bundled
`static/` dir. Use this for all local iteration.

## Release build (rebuild + clear caches, no PyPI)

To produce a clean, shippable build without publishing:

```bash
# 1. Clear Python build artifacts
rm -rf dist build src/vibefoundry.egg-info

# 2. Clear the bundled static files (belt-and-suspenders; vite also does this)
rm -rf src/vibefoundry/static/*

# 3. Rebuild the frontend bundle into src/vibefoundry/static/
cd frontend && npm install && npm run build && cd ..

# 4. Build the Python package (wheel + sdist into dist/)
python -m build
```

After this, `dist/` holds the new `.whl` and `.tar.gz`, and
`src/vibefoundry/static/` holds the fresh UI bundle. Nothing has been
published.

To smoke-test the built wheel locally:

```bash
pip install --force-reinstall dist/vibefoundry-*.whl
vibefoundry /path/to/test/project
```

## Publishing to PyPI (final gate — do this only when ready)

`publish.sh` runs the full sequence: bump version → clear caches → rebuild
frontend → build package → upload to PyPI. The PyPI token is read from `.env`
(`PYPI_TOKEN=pypi-...`, gitignored).

```bash
./publish.sh 0.2.14      # bumps pyproject.toml version, builds, uploads
```

Do **not** run this until the release has been verified — a published PyPI
version cannot be replaced, only superseded by a new version number.

## Service worker caveat

A service worker (`src/vibefoundry/static/sw.js`) is shipped and caches the
app in the browser. After a new version is published, a browser that already
loaded the IDE may keep serving the **old** bundle until the service worker
updates on a subsequent load.

This is a runtime cache, not a build cache — a correct rebuild does not fix
it. If you publish a fix and don't see it, hard-reload (or clear site data /
unregister the service worker) before concluding the build was wrong.
