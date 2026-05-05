# pwa_duckdb — Clone & Customize Recipe

This template is a working DuckDB-WASM + React PWA. For a Track 2 task, **clone it instead of building from scratch.** Read this file before doing anything else — it tells you exactly what's here and what to change.

## What's in here

```
build_app_package.py             <- Builds the distributable. No edits.
run_app.sh / run_app.bat         <- Dev launchers (stage + serve). No edits.
app_core/
  prepare_dev_assets.py          <- Stages parquet from input_folder/. No edits.
  serve.py                       <- Local HTTP server. No edits.
  sample_data/                   <- Demo parquets. DELETE after cloning.
  src_app/
    index.html                   <- Hardcoded "Data Viewer" title. REPLACE.
    css/styles.css               <- Generic styles. Skip unless asked.
    js/app.js                    <- React app, reads app_config.json. No edits.
    lib/                         <- Pre-bundled React + DuckDB-WASM (~33 MB wasm). No touch.
    data/
      app_config.json            <- REWRITE.
      *.parquet                  <- Sample parquets. DELETE after cloning.
```

`build_app_package.py:20` reads the app name from the task folder's basename, so renaming the destination at clone time is all the "rename" you need.

## Ground rules

**Light exploration is fine — heavy reading is not.** Running `ls` or scanning the inventory above is free. But don't open the contents of any file tagged "No edits" or "No touch" — you don't need to know how `app.js` consumes the config or how `prepare_dev_assets.py` mirrors `input_folder/`. Trust this recipe. Files you *do* need to open: `index.html` (to replace the title), the user's parquets (one `head(5)` per file), and the existing `app_config.json` if you want to see the schema by example. That's it.

**One Polars call per parquet.** `pl.scan_parquet(file).head(5).collect()` gives you names, dtypes, and sample values in one shot. Don't follow up with `n_unique`, `describe`, `group_by`, or "just one more to verify" — none of those are needed for the lightest-touch config you're writing.

**Fit the data to the app. Do not improve the app.** This recipe exists because the template already works. Your job is to swap in the user's data, write the config, and stop. Specifically:

- **Don't edit `css/styles.css`** — the styling is fine, the user didn't ask.
- **Don't edit `js/app.js`** — the rendering is fine, the user didn't ask. Even if you spot something you'd "fix" (null formatting, empty states, error handling), leave it.
- **Don't add features** — no new columns, no derived fields, no summary widgets, no charts, no export buttons, no search bars, no toasts. If the user wants any of those, they'll ask after seeing the app.
- **Don't refactor anything** — no renames, no restructures, no helpers extracted, no "while I'm here" cleanup of the build script or launchers.

If you notice something you'd like to improve, *ignore the thought*. Adding scope is the single biggest cause of a 30-second clone turning into a 6-minute rewrite.

If you've spent more than ~60 seconds of work on steps 1-5, you've gone too deep. Stop, re-read this file, finish the recipe.

## The 5 steps

```bash
# 1. Clone the template into the task folder.
cp -r templates/pwa_duckdb app_folder/scripts/{task_name}
cd app_folder/scripts/{task_name}

# 2. Strip the recipe + sample data from the clone.
rm CUSTOMIZE.md
rm app_core/sample_data/*.parquet
rm app_core/src_app/data/*.parquet

# 3. Move the user's parquets into src_app/data/.
#    Leave originals in input_folder/ — prepare_dev_assets.py keeps them mirrored
#    on every dev launch.
cp ../../../input_folder/<user_files>.parquet app_core/src_app/data/

# 4. Inspect each parquet — lightest touch only.
#    Just column names, dtypes, and a couple of sample values so you can write
#    sensible labels. No n_unique queries, no filter heuristics, no histograms.
python -c "import polars as pl; print(pl.scan_parquet('app_core/src_app/data/<f>.parquet').head(5).collect())"

# 5. Rewrite app_core/src_app/data/app_config.json + replace the index.html title.
```

## Step 5a — `app_config.json` shape

```json
{
  "app_title": "Pick from the task description",
  "datasets": [
    {
      "id": "stable_id",
      "label": "Display Name",
      "file": "actual_file.parquet",
      "columns": [
        { "name": "raw_col_name", "label": "Title Case Label" }
      ]
    }
  ]
}
```

**Do NOT add `filter` fields to any column.** Every column renders display-only on first launch. The user adds `"filter": "text" | "select" | "range" | "boolean"` themselves once they see the data and decide what they want filterable. Don't pre-decide for them.

## Step 5b — `index.html` title

Two hardcoded places. Replace both with the same value as `app_title`:

- `<title>Data Viewer</title>`
- `<p>Loading Data Viewer...</p>`

## Launch

```bash
bash app_folder/scripts/{task_name}/run_app.sh
```

Browser opens, datasets load in DuckDB-WASM, table renders. Hand off — the user clicks around and tells you which columns need filters.

## What you don't do

- No npm, no esbuild, no React download — `lib/` is pre-bundled and committed.
- No `manifest.json` — `app_config.json` is the source of truth.
- No filter inference. The user picks widgets after seeing the data.
