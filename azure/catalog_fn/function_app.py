"""The Data Catalogue service.

Two jobs:

  build_catalogue (timer)  — reads the SharePoint library with an app-only Graph
                             token, profiles every dataset, describes each one,
                             and writes the finished catalogue to blob storage.
                             Runs on a schedule; no user triggers it.
  GET  /api/catalog        — serves that prebuilt catalogue to the app.
  POST /api/describe       — the original per-profile describer, kept for the
                             local-profiling path and for one-off calls.

The catalogue is built centrally so a team shares one result: nobody clicks
"build", nobody waits, and the OpenAI key never leaves Azure. The trade is that
raw customer data is now read and profiled here rather than on the user's
machine — which is why the daemon holds Graph `Sites.Selected` plus an explicit
per-site grant, not tenant-wide read.
"""

import json
import logging
import os
import time
from pathlib import Path

import azure.functions as func
from openai import OpenAI

import builder

app = func.FunctionApp(http_auth_level=func.AuthLevel.FUNCTION)

# gpt-5.6-luna is the cost-optimised tier; this is structured summarisation, not
# reasoning, so the cheap tier is the right call. Override per-deployment.
MODEL = os.environ.get("CATALOG_MODEL", "gpt-5.6-luna")

RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {
            "type": "string",
            "description": "Short plain-English title, max ~8 words. e.g. 'Daily sales by product and store'",
        },
        "summary": {
            "type": "string",
            "description": (
                "Two or three short, plain sentences describing WHAT THIS DATASET IS "
                "as a whole — the real-world thing it captures, what it covers, what "
                "it's for. Not a description of its columns."
            ),
        },
        "grain": {
            "type": "string",
            "description": "One short sentence starting 'One row is'. e.g. 'One row is one product in one store.'",
        },
        "columns": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "description": {"type": "string"},
                },
                "required": ["name", "description"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["title", "summary", "grain", "columns"],
    "additionalProperties": False,
}

SYSTEM = (
    "You write data catalogue entries in PLAIN ENGLISH. You are given a "
    "statistical profile of a dataset: column names, types, and either distinct "
    "values (categorical) or summary statistics (continuous). Work out what the "
    "dataset actually is and explain it to a smart colleague who has never seen "
    "it and is not a data engineer.\n\n"
    "THE SUMMARY IS ABOUT THE DATASET AS A WHOLE — not its columns.\n"
    "Answer: what IS this? What real-world thing does it capture, over what\n"
    "scope and period, and what would someone use it for? The reader can see the\n"
    "columns and statistics elsewhere; do not narrate them back.\n"
    "  GOOD: 'Retail sales history for a US grocery chain. It tracks how many\n"
    "  units of each product sold each day across four California stores over\n"
    "  roughly two years — the kind of data used for demand forecasting and\n"
    "  inventory planning.'\n"
    "  BAD (this is column narration, do not do it): 'Wide-format daily\n"
    "  unit-sales history for 3,049 items. The 732 d_ columns are numbered days.\n"
    "  Across days d_1210 to d_1253 the average is 1 to 2 units.'\n"
    "Do NOT list, name or explain columns in the summary. Do NOT quote averages,\n"
    "minimums or maximums. Numbers only where they convey scale, and ONLY where\n"
    "the profile actually supports them.\n"
    "TIME PERIODS: state one only if a temporal column gives you a real date\n"
    "range. NEVER infer a period from a column count, a row count, or codes like\n"
    "week numbers or day keys — you will get it wrong. If there's no date range\n"
    "in the profile, just don't mention the period at all.\n\n"
    "Write like a person, not a data warehouse:\n"
    "- Short, ordinary sentences. Two or three, never more.\n"
    "- BANNED words, they mean nothing to most readers: wide-format, long-format,\n"
    "  dimension, dimension table, fact table, grain, granularity, cardinality,\n"
    "  schema, entity, denormalised, time-series period, supports X-level\n"
    "  analysis, this dataset contains, this table records.\n"
    "- Infer the domain from the data and say it. Product codes like\n"
    "  HOBBIES_1_001 and stores like CA_1 mean retail, so say retail.\n"
    "- If another dataset is needed to make sense of this one, that's worth one\n"
    "  short clause at the end — not a paragraph.\n\n"
    "The `grain` field: what one row is, one short sentence starting 'One row\n"
    "is'. E.g. 'One row is one product in one store.' Never use the word grain.\n\n"
    "Column descriptions: one short line each, what it means in practice. Skip\n"
    "the datatype, the reader can see it. If a column is cryptic and the profile\n"
    "doesn't disambiguate it, say so plainly rather than inventing a meaning.\n"
    "Never speculate beyond what the profile supports."
)


def _build_prompt(ds: dict) -> str:
    lines = [
        f"Dataset: {ds.get('name')}",
        f"Rows: {ds.get('rows'):,}" if ds.get("rows") else "Rows: unknown",
        f"Columns: {ds.get('n_columns')}",
    ]
    if ds.get("siblings"):
        lines.append(
            "Other datasets in the same folder (context only, do not describe "
            f"them): {', '.join(ds['siblings'])}"
        )
    shown = ds.get("columns", [])
    if ds.get("n_columns", 0) > len(shown):
        lines.append(
            f"\nShowing {len(shown)} of {ds['n_columns']} columns; the remainder "
            "follow the same naming pattern."
        )
    lines.append("\nColumn profile:")
    for c in shown:
        bits = [f"- {c['name']} ({c['dtype']}, {c['kind']})"]
        if c.get("nulls"):
            bits.append(f"nulls={c['nulls']}")
        if c["kind"] == "categorical":
            bits.append(f"{c.get('n_unique')} distinct")
            if c.get("values"):
                vals = ", ".join(str(v) for v in c["values"])
                bits.append(f"e.g. {vals}")
        elif c["kind"] == "temporal":
            bits.append(f"range {c.get('min')} .. {c.get('max')}")
        else:
            bits.append(
                f"min={c.get('min')} max={c.get('max')} "
                f"mean={c.get('mean')} median={c.get('median')}"
            )
        lines.append("  ".join(bits))
    return "\n".join(lines)


def describe_profile(ds: dict, siblings: list[str] | None = None) -> dict:
    """Profile -> prose. Called in-process by the builder and over HTTP by /describe."""
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        return {"error": "OPENAI_API_KEY app setting is not configured"}

    payload = dict(ds)
    if siblings:
        payload["siblings"] = [s for s in siblings if s != ds.get("name")]
    try:
        client = OpenAI(api_key=key)
        resp = client.responses.create(
            model=MODEL,
            input=[
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": _build_prompt(payload)},
            ],
            text={
                "format": {
                    "type": "json_schema",
                    "name": "catalog_entry",
                    "schema": RESPONSE_SCHEMA,
                    "strict": True,
                }
            },
        )
        out = json.loads(resp.output_text)
        out["model"] = MODEL
        return out
    except Exception as e:
        logging.exception("describe failed for %s", ds.get("name"))
        return {"error": f"{type(e).__name__}: {e}"}


@app.route(route="describe", methods=["POST"])
def describe(req: func.HttpRequest) -> func.HttpResponse:
    try:
        body = req.get_json()
    except ValueError:
        return func.HttpResponse(
            json.dumps({"error": "body must be JSON"}), status_code=400,
            mimetype="application/json",
        )

    ds = body.get("dataset")
    if not ds or not ds.get("name"):
        return func.HttpResponse(
            json.dumps({"error": "missing dataset.name"}), status_code=400,
            mimetype="application/json",
        )

    out = describe_profile(ds, ds.get("siblings"))
    if out.get("error"):
        status = 503 if "OPENAI_API_KEY" in out["error"] else 502
        return func.HttpResponse(json.dumps(out), status_code=status, mimetype="application/json")
    return func.HttpResponse(json.dumps(out), mimetype="application/json")


@app.route(route="health", methods=["GET"], auth_level=func.AuthLevel.ANONYMOUS)
def health(req: func.HttpRequest) -> func.HttpResponse:
    """Unauthenticated liveness probe — reports config state, never the key."""
    return func.HttpResponse(
        json.dumps({
            "ok": True,
            "model": MODEL,
            "openai_key_configured": bool(os.environ.get("OPENAI_API_KEY")),
            "graph_configured": bool(os.environ.get("GRAPH_CLIENT_SECRET")),
            "site": os.environ.get("CATALOG_SITE_ID", "")[:40],
        }),
        mimetype="application/json",
    )


# --- The centrally-built catalogue -------------------------------------------
BLOB_NAME = "catalog.json"


def _blob_client():
    from azure.storage.blob import BlobServiceClient
    svc = BlobServiceClient.from_connection_string(os.environ["CATALOG_BLOB_CONN"])
    return svc.get_blob_client(
        container=os.environ.get("CATALOG_BLOB_CONTAINER", "catalogs"), blob=BLOB_NAME
    )


def read_catalog() -> dict:
    try:
        return json.loads(_blob_client().download_blob().readall())
    except Exception:
        return {}


def write_catalog(data: dict) -> None:
    _blob_client().upload_blob(json.dumps(data, indent=2), overwrite=True)


def build_catalogue() -> dict:
    """Read the library, profile what changed, describe it, store the result."""
    import httpx

    site = os.environ["CATALOG_SITE_ID"]
    folder = os.environ.get("CATALOG_FOLDER", "")
    token = builder.graph_token()

    previous = read_catalog()
    cached = previous.get("datasets", {}) if previous.get("folder") == folder else {}
    out: dict = {}

    with httpx.Client() as client:
        files = builder.list_datasets(client, token, site, folder)
        names = [f["name"] for f in files]

        # A workbook is a container, not a table: each sheet is its own dataset,
        # or an 11-tab P&L gets catalogued as whatever its first tab happens to be.
        expanded = []
        for f in files:
            if Path(f["name"]).suffix.lower() not in (".xlsx", ".xls"):
                expanded.append(f)
                continue
            try:
                raw = builder.fetch_bytes(client, f, token)
                sheets = builder.excel_sheets(raw)
            except Exception:
                expanded.append(f)
                continue
            if len(sheets) <= 1:
                expanded.append(f)
                continue
            for s in sheets:
                e = dict(f)
                e["sheet"] = s
                e["path"] = f["path"] + builder.SHEET_SEP + s
                expanded.append(e)

        for f in expanded:
            key = f["path"]
            fp = builder.fingerprint(f)
            prev = cached.get(key)
            # Only re-read and re-describe what actually changed.
            if prev and prev.get("fingerprint") == fp and not prev.get("error"):
                out[key] = prev
                continue
            try:
                raw = builder.fetch_bytes(client, f, token)
                df = builder.read_frame(f["name"], raw, f.get("sheet"))
                profile = builder.profile_frame(df, f["name"], len(raw))
                profile["path"] = f["path"]
                if f.get("sheet"):
                    profile["sheet"] = f["sheet"]
                described = describe_profile(profile, names)
                out[key] = merge_entry(profile, described, fp)
            except Exception as e:
                logging.exception("cataloguing %s failed", key)
                out[key] = {
                    "fingerprint": fp, "name": f["name"], "path": f["path"],
                    "size_bytes": f.get("size"), "columns": [],
                    "error": f"{type(e).__name__}: {e}",
                }

    data = {
        "folder": folder,
        "site": site,
        "built_at": int(time.time()),
        "datasets": out,
    }
    write_catalog(data)
    return data


def merge_entry(profile: dict, described: dict, fp: str) -> dict:
    cols = {c["name"]: c["description"] for c in described.get("columns", [])}
    for c in profile["columns"]:
        if c["name"] in cols:
            c["description"] = cols[c["name"]]
    return {
        "fingerprint": fp,
        "name": profile["name"],
        "path": profile.get("path") or profile["name"],
        "sheet": profile.get("sheet"),
        "size_bytes": profile["size_bytes"],
        "rows": profile["rows"],
        "n_columns": profile["n_columns"],
        "title": described.get("title"),
        "summary": described.get("summary"),
        "grain": described.get("grain"),
        "model": described.get("model"),
        "error": described.get("error"),
        "columns": profile["columns"],
        "built_at": int(time.time()),
    }


@app.timer_trigger(schedule="0 0 * * * *", arg_name="timer", run_on_startup=False)
def build_catalogue_timer(timer: func.TimerRequest) -> None:
    """Hourly. Unchanged datasets are skipped, so a quiet hour costs almost nothing."""
    try:
        data = build_catalogue()
        logging.info("catalogue built: %d dataset(s)", len(data.get("datasets", {})))
    except Exception:
        logging.exception("scheduled catalogue build failed")


@app.route(route="catalog", methods=["GET"])
def catalog(req: func.HttpRequest) -> func.HttpResponse:
    """Serve the prebuilt catalogue. The app reads this instead of building."""
    cat = read_catalog()
    return func.HttpResponse(
        json.dumps({
            "folder": cat.get("folder"),
            "built_at": cat.get("built_at"),
            "datasets": list(cat.get("datasets", {}).values()),
            "serviceConfigured": True,
        }),
        mimetype="application/json",
    )


@app.route(route="catalog/build", methods=["POST"])
def catalog_build_now(req: func.HttpRequest) -> func.HttpResponse:
    """Manual rebuild — an admin escape hatch, not the normal path."""
    try:
        data = build_catalogue()
        return func.HttpResponse(
            json.dumps({"built_at": data["built_at"], "count": len(data["datasets"])}),
            mimetype="application/json",
        )
    except Exception as e:
        logging.exception("manual build failed")
        return func.HttpResponse(
            json.dumps({"error": f"{type(e).__name__}: {e}"}),
            status_code=502, mimetype="application/json",
        )
