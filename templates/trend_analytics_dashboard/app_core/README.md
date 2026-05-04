# trend_analytics_dashboard

Track 2 PWA — **Trend Analytics Dashboard**. Forked from `geo_dashboard/` (the template), with the map removed and three Chart.js charts added in its place.

## What it shows

- **Top metrics bar**: Accounts, Cases 2024, Cases 2025, Cases 2026
- **Pie**: Accounts by Channel
- **Bar**: Top 10 Brands by total cases (2024–2026 combined), horizontal
- **Line**: Cases per year (2024 → 2025 → 2026), one line per Channel
- **Account Details table**: paginated, sortable, per-column filterable

Same sidebar filter set as the geo dashboard.

## Differences from the geo template

- **Removed**: `MapPanel`, county heatmap, boundary layers, Leaflet, Supercluster
- **Added**: Chart.js, three chart components (Pie/Bar/Line), top metrics bar
- **Sidebar**: same filters minus heatmap/boundary toggles
- **Layout**: `sidebar | (metrics bar → 3-chart row → table)`
- **Vite ports**: 5174/4174 (so geo + trend can run side by side)

## Two dev workflows

| Goal | Command |
|---|---|
| Local testing with HMR | `bash run_app.sh` |
| Explicit package build | `python3 build_app_package.py` |
