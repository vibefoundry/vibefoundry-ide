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
