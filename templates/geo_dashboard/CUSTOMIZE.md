# Customize this template

> **Read this first if you're an AI agent customizing this template for a new use case.** This is the 5-step recipe — follow it in order and don't deviate. Customization should take 30-60 seconds, not minutes.

## Step 1 — Identify the user's data

Read `app_folder/meta_data/input_metadata.txt`. You're looking for:

- A file with **lat/long columns** (this template REQUIRES geographic point data — if the user's data has no coordinates, pick a different template)
- **Categorical columns** the user might want to filter on (e.g., channel, segment, tier)
- **Numeric columns** the user wants as metrics (e.g., sales, units, count)
- **Optional** state/county/tract identifier columns for boundary overlays

## Step 2 — Fork the template

```bash
# Mac/Linux
rsync -av --exclude='sample_data/' --exclude='node_modules/' --exclude='dist/' \
  app_folder/templates/geo_dashboard/ \
  app_folder/scripts/{your_task_name}/

# Windows (PowerShell)
Copy-Item -Recurse app_folder\templates\geo_dashboard app_folder\scripts\{your_task_name}
Remove-Item -Recurse -Force app_folder\scripts\{your_task_name}\app_core\sample_data, app_folder\scripts\{your_task_name}\app_core\node_modules, app_folder\scripts\{your_task_name}\app_core\dist -ErrorAction SilentlyContinue
```

## Step 3 — Edit ONE file: `app_core/src_app/data/app_config.json`

This is the **only file you need to edit for most customizations**. Replace the values based on the user's metadata:

```json
{
  "data": {
    "file": "EDIT_ME — filename in input_folder/, e.g. accounts.parquet",
    "lat_column": "EDIT_ME — column with latitude values",
    "long_column": "EDIT_ME — column with longitude values",
    "account_id_column": "EDIT_ME — unique identifier column (or leave existing)",
    "state_code_column": "EDIT_ME — 2-letter state column (or remove if N/A)",
    "county_geoid_column": "EDIT_ME — county GEOID column (or remove if N/A)"
  },
  "columns": [
    // EDIT_ME — one entry per column the user wants visible/filterable.
    // Roles: "color_by" (categorical for map dot colors), "size" (numeric for dot size),
    //        "metric" (numeric, shown as a stat), "categorical_filter", "text_filter".
    // Filterable: "select" (dropdown), "range" (numeric slider), "text" (search box), or omitted.
  ]
}
```

**Common shape**: 5-12 entries in `columns[]`. Pick the ones most relevant to the user's stated goal.

## Step 4 — Edit `manifest.json` (one line)

`app_core/src_app/data/manifest.json` — update `displayName` to match the user's domain (e.g., "Q3 Restaurant Distribution").

## Step 5 — Run it

```bash
# Mac/Linux
bash app_folder/scripts/{your_task_name}/run_app.sh

# Windows
app_folder\scripts\{your_task_name}\run_app.bat
```

The launcher resolves data: `input_folder/{file_from_config}` first, then falls back to the template's example path. **Do not commit the user's real data — let `input_folder/` be the source.**

## Don't touch unless asked

- `app_core/src_app/js/app.js` — 1600+ lines. Driven by `app_config.json`. Only edit if the user explicitly wants new chart types, new map layers, or behavior changes the config can't express.
- `app_core/prepare_dev_assets.py` and `build_app_package.py` — dev/build orchestration. Don't edit.
- `vite.config.js`, `package.json` — leave alone.
- TIGER `boundaries/` — gitignored, downloaded separately. Don't try to commit them.

## When NOT to use this template

- User's data has no lat/long → use `trend_analytics_dashboard` or a Track 1 pipeline instead
- User wants something interactive but server-side → Track 3 (full-stack)
- User just wants a chart → Track 1 with a `.png` output is faster
