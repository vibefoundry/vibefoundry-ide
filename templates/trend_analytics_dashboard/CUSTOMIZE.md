# Customize this template

> **Read this first if you're an AI agent customizing this template for a new use case.** This is the 5-step recipe — follow it in order and don't deviate. Customization should take 30-60 seconds, not minutes.

## Step 1 — Identify the user's data

Read `app_folder/meta_data/input_metadata.txt`. You're looking for:

- **Time / period columns** (date, year, month, quarter — this template's whole purpose is showing trends over time)
- **Categorical columns** for grouping/filtering (segment, brand, channel, region)
- **Numeric metric columns** the user wants to track over time (sales, volume, count)

If the user's data has no temporal dimension, pick a different template — this one shows trends.

## Step 2 — Fork the template

```bash
# Mac/Linux
rsync -av --exclude='sample_data/' --exclude='node_modules/' --exclude='dist/' \
  app_folder/templates/trend_analytics_dashboard/ \
  app_folder/scripts/{your_task_name}/

# Windows (PowerShell)
Copy-Item -Recurse app_folder\templates\trend_analytics_dashboard app_folder\scripts\{your_task_name}
Remove-Item -Recurse -Force app_folder\scripts\{your_task_name}\app_core\sample_data, app_folder\scripts\{your_task_name}\app_core\node_modules, app_folder\scripts\{your_task_name}\app_core\dist -ErrorAction SilentlyContinue
```

## Step 3 — Edit ONE file: `app_core/src_app/data/app_config.json`

Most customizations only need this one file. Replace the values based on the user's metadata:

```json
{
  "data": {
    "file": "EDIT_ME — filename in input_folder/, e.g. monthly_sales.parquet",
    "date_column": "EDIT_ME — primary date/period column",
    "metric_columns": [
      "EDIT_ME — list of numeric columns to track over time"
    ]
  },
  "columns": [
    // EDIT_ME — one entry per column the user wants visible/filterable.
    // Roles: "metric" (numeric, shown as a trend line / KPI),
    //        "categorical_filter" (dropdown filter),
    //        "text_filter" (search box).
    // Filterable: "select", "range", "text", or omitted.
  ]
}
```

**Common shape**: 5-10 entries in `columns[]`. Focus on what's most relevant to the user's stated trend question (e.g., "show monthly sales by channel" → date_column + metric + channel categorical filter).

## Step 4 — Edit `manifest.json` (one line)

`app_core/src_app/data/manifest.json` — update `displayName` to match the user's domain (e.g., "Monthly Sales by Channel — 2024-2026").

## Step 5 — Run it

```bash
# Mac/Linux
bash app_folder/scripts/{your_task_name}/run_app.sh

# Windows
app_folder\scripts\{your_task_name}\run_app.bat
```

The launcher resolves data: `input_folder/{file_from_config}` first, then template's sample fallback. **Do not commit the user's real data.**

## Don't touch unless asked

- `app_core/src_app/js/app.js` — driven by `app_config.json`. Only edit for new chart types or behaviors the config can't express.
- `app_core/prepare_dev_assets.py` and `build_app_package.py` — dev/build orchestration. Don't edit.
- `vite.config.js`, `package.json` — leave alone.

## When NOT to use this template

- User's data has lat/long and they want a map → use `geo_dashboard`
- User wants a one-shot static chart, not interactive → Track 1 with `.png` output
- Server-side data, auth, or RAG required → Track 3 full-stack
