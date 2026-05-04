# geo_dashboard

Track 2 PWA — **Distribution Geo Dashboard** boilerplate. Plain-script architecture (no npm, no Vite, no bundler) — runs entirely in the user's browser via DuckDB-WASM querying a Parquet file.

## What this is

A generic interactive geo dashboard for any "accounts × products × multi-period sales" dataset: filterable table + map, county heatmap, and state/county/tract boundary overlays.

The default sample data ships an olive-oil distributor in the US Northeast (NY, NJ, MA, PA, CT, RI). Swap `app_core/sample_data/sample.parquet` (or drop a real parquet at `input_folder/app_data.parquet`) to use it for a different business.

## Architecture

- **DuckDB-WASM** runs SQL queries on Parquet files directly in the browser
- **React 18 UMD** loaded via `<script>` tag — no JSX, no build step
- **Leaflet + Supercluster** for the map and clustering, also UMD via `<script>`
- **Local HTTP server** (Python `http.server` on Mac/Linux/Windows) serves the static files
- **No backend, no npm, no Node required** on the user's machine

`prepare_dev_assets.py` downloads the UMD/IIFE builds (~5 MB) on first run and caches them under `app_core/src_app/lib/`.

## Genericization status

Top-of-file constants are externalized to `app_core/src_app/data/app_config.json`. Inline column references in `js/app.js` are partly hardcoded — same shape, same behavior — only the config schema is portable. Future evolution: roles + labels driven entirely from config so a different business can reuse the app via config swap.

## Folder layout

```
geo_dashboard/
├── build_app_package.py        <- Builds the Track 2 distributable
├── run_app.sh / run_app.bat    <- Local dev launcher (calls prep + serve_dev.py)
├── CUSTOMIZE.md                <- 5-step recipe for the agent
└── app_core/
    ├── prepare_dev_assets.py   <- Downloads UMDs + stages dataset
    ├── serve_dev.py            <- Cross-platform HTTP server with COOP/COEP
    ├── README.md               <- this file
    └── src_app/
        ├── index.html, css/, js/  <- Source — edit these
        ├── data/
        │   ├── app_config.json    <- COMMITTED — column metadata + edit point
        │   ├── manifest.json      <- COMMITTED — dataset display name
        │   ├── *.parquet          <- gitignored, staged by prepare_dev_assets
        │   └── boundaries/        <- gitignored, TIGER reference GeoJSONs
        └── lib/                   <- gitignored, downloaded UMDs
```

## Data sourcing (build/dev script priority)

`prepare_dev_assets.py` and `build_app_package.py` resolve the dataset in this order:
1. `input_folder/{file_from_app_config.json}` — real client data (overwrites)
2. Existing `src_app/data/{file}` if present (kept as-is)
3. `app_core/sample_data/sample.parquet` — synthetic fallback (small, committed)

## Two workflows

| Goal | Command | What it does |
|---|---|---|
| Local dev with refresh-to-update | `bash run_app.sh` (Mac) / `run_app.bat` (Windows) | Stages assets, serves `src_app/` on a free port, opens browser. Refresh browser to see edits. |
| Build distributable | `python build_app_package.py` | Stages assets, copies to `output_folder/{app_name}/application_files/`, generates `pc_start.bat` / `mac_start.command` / `mac_start.sh` launchers. Zip the package and ship it. |

Edits to `index.html`, `js/app.js`, `css/styles.css` show up on browser refresh — there's no HMR (intentional — keeps the stack zero-install).
