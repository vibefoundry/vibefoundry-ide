"""Dataset describer — turns a column profile into prose for the Data Catalogue.

Deliberately dumb and stateless: it takes a profile that the VibeFoundry backend
computed locally and returns descriptions. It never touches SharePoint, holds no
credentials for the user's data, and keeps the OpenAI key server-side so it is
never shipped to clients.

Auth is the built-in Azure function key (AuthLevel.FUNCTION). That is not a
substitute for real user auth — see README.md — but it does keep the endpoint
from being an open relay to the OpenAI key.
"""

import json
import logging
import os

import azure.functions as func
from openai import OpenAI

app = func.FunctionApp(http_auth_level=func.AuthLevel.FUNCTION)

# gpt-5.6-luna is the cost-optimised tier; this is structured summarisation, not
# reasoning, so the cheap tier is the right call. Override per-deployment.
MODEL = os.environ.get("CATALOG_MODEL", "gpt-5.6-luna")

RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {
            "type": "string",
            "description": "Short human title for the dataset, e.g. 'Daily unit sales by item and store'",
        },
        "summary": {
            "type": "string",
            "description": "2-3 sentences: what this dataset contains and what it is for.",
        },
        "grain": {
            "type": "string",
            "description": "What one row represents, e.g. 'one item-store combination'.",
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
    "You write data catalogue entries. You are given a statistical profile of a "
    "dataset: column names, types, and either distinct values (categorical) or "
    "summary statistics (continuous). Infer what the dataset actually is and "
    "describe it for an analyst who has never seen it.\n\n"
    "Rules:\n"
    "- Be concrete and specific. 'Daily unit sales per item per store' beats "
    "'a table of sales data'.\n"
    "- Say what one row represents (the grain).\n"
    "- Describe every column you are given, briefly. Explain what the column "
    "means, not its datatype - the reader can already see the type.\n"
    "- If a column is cryptic and the profile does not disambiguate it, say so "
    "plainly rather than inventing a meaning.\n"
    "- Do not speculate beyond what the profile supports."
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

    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        # Explicit, so a missing app setting doesn't look like a model failure.
        return func.HttpResponse(
            json.dumps({"error": "OPENAI_API_KEY app setting is not configured"}),
            status_code=503, mimetype="application/json",
        )

    try:
        client = OpenAI(api_key=key)
        resp = client.responses.create(
            model=MODEL,
            input=[
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": _build_prompt(ds)},
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
        return func.HttpResponse(json.dumps(out), mimetype="application/json")
    except Exception as e:
        logging.exception("describe failed for %s", ds.get("name"))
        return func.HttpResponse(
            json.dumps({"error": f"{type(e).__name__}: {e}"}),
            status_code=502, mimetype="application/json",
        )


@app.route(route="health", methods=["GET"], auth_level=func.AuthLevel.ANONYMOUS)
def health(req: func.HttpRequest) -> func.HttpResponse:
    """Unauthenticated liveness probe — reports config state, never the key."""
    return func.HttpResponse(
        json.dumps({
            "ok": True,
            "model": MODEL,
            "openai_key_configured": bool(os.environ.get("OPENAI_API_KEY")),
        }),
        mimetype="application/json",
    )
