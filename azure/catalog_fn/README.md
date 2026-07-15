# VibeFoundry SharePoint — dataset describer

The Azure function behind the **Data Catalogue** tab in VibeFoundry.

It takes a column profile and returns prose: a title, a summary, what one row
represents (the grain), and a description per column. That's all it does.

## Why it's this small

Profiling happens on the user's machine, not here. The VibeFoundry backend reads
the SharePoint file with the user's own delegated token, computes the profile,
and posts only that profile up. So:

- the SharePoint token never leaves the user's machine, and this function needs
  no SharePoint permissions of its own;
- the OpenAI key lives here and is never shipped to a client;
- the only thing crossing the boundary is a statistical profile.

Column *values* do cross it (distinct values for categoricals) — that's what
makes the descriptions good, and it's the thing to think about before pointing
this at a folder with personal data in it.

## Endpoints

| | |
|---|---|
| `POST /api/describe` | profile in, descriptions out. Needs the function key. |
| `GET /api/health` | anonymous. Reports the model and whether the key is set — never the key. |

`POST /api/describe` body:

```json
{ "dataset": { "name": "sales.csv", "rows": 12196, "n_columns": 738,
               "columns": [ { "name": "store_id", "dtype": "String",
                              "kind": "categorical", "n_unique": 4,
                              "values": ["CA_1","CA_2","CA_3","CA_4"] } ] } }
```

## Deploy

```bash
az functionapp deployment source config-zip \
  -n vibefoundry-catalog-api -g rg-vibefoundry-catalog \
  --src fn.zip --build-remote true
```

`--build-remote true` is not optional. Without it the app runs the zip as-is,
never pip-installs `openai`, the worker dies on import, and every route 404s
with no error anywhere obvious.

## App settings

| setting | notes |
|---|---|
| `OPENAI_API_KEY` | set via `az functionapp config appsettings set`. Never commit it — GitHub secret-scanning auto-revokes leaked OpenAI keys, so a hardcoded key is the one approach guaranteed to stop working. |
| `CATALOG_MODEL` | defaults to `gpt-5.6-terra`. The lineup is `gpt-5.6-sol` / `terra` / `luna` — there is no `gpt-5-mini`. |
| `AzureWebJobsFeatureFlags` | must be `EnableWorkerIndexing`, or the Python v2 decorator model registers zero functions and every route 404s. |

## Client config

The VibeFoundry backend reads `~/.vibefoundry/catalog_service.json`:

```json
{ "url": "https://vibefoundry-catalog-api.azurewebsites.net/api/describe",
  "key": "<function key>" }
```

Without it the catalogue still profiles datasets — it just won't describe them.

## Known gaps

- **Auth is the Azure function key only.** Fine for a single-user test; it is not
  per-user auth. Anyone with the URL and key can spend your OpenAI budget. Gate
  it behind the VibeFoundry sign-in token before this is real.
- **No rate limiting or spend cap.**
- Prompts are capped at 50 columns and 25 distinct values per column to keep
  requests small; wide files are described from a sample of their columns.
