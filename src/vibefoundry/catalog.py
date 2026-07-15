"""Data Catalogue — profiles SharePoint datasets and has them described.

Split of responsibility, deliberately:
  - here (local):  read the file, compute the profile. The delegated SharePoint
                   token never leaves the user's machine.
  - Azure function: turn a profile into prose. Holds the OpenAI key, sees no
                   credentials and never touches the library.

Profiles are cached per dataset and keyed on a fingerprint of size + last
modified, so a dataset is only re-read (and re-described) when it actually
changes. Cataloguing is a one-time cost per upload.

Why full reads rather than range requests: SharePoint's REST $value endpoint
ignores HTTP Range (verified — it returns 200 and the whole body). It streams at
~25 MB/s, so a 100 MB CSV is a few seconds. Reading only the head would be fast
but wrong: these files are sorted, so the first rows report one distinct
store_id when there are ten. Distinct values have to come from the whole column.
"""

import io
import json
import time
from pathlib import Path
from typing import Optional
from urllib.parse import quote

import httpx
import polars as pl

# Keep prompts small and cheap. A wide file (sales.csv has 738 columns) would
# otherwise dominate the request; the model infers the pattern from a sample.
MAX_COLUMNS_DESCRIBED = 50
MAX_DISTINCT_SHOWN = 25
# Above this, a low-cardinality numeric column is treated as continuous.
CATEGORICAL_MAX_UNIQUE = 20

DATA_SUFFIXES = {".csv", ".tsv", ".parquet", ".xlsx", ".xls", ".json"}


def config_path() -> Path:
    home = Path.home() / ".vibefoundry"
    home.mkdir(exist_ok=True)
    return home / "catalog.json"


def read_catalog() -> dict:
    try:
        return json.loads(config_path().read_text())
    except Exception:
        return {}


def write_catalog(data: dict) -> None:
    config_path().write_text(json.dumps(data, indent=2))


def service_config() -> dict:
    """Where the describer lives: {"url": ..., "key": ...}."""
    try:
        return json.loads((Path.home() / ".vibefoundry" / "catalog_service.json").read_text())
    except Exception:
        return {}


def fingerprint(f: dict) -> str:
    """Cache key — re-profile only when the file actually changed."""
    return f"{f.get('size')}:{f.get('modified')}"


def _classify(dtype: pl.DataType, n_unique: int) -> str:
    if dtype in (pl.Utf8, pl.String, pl.Categorical, pl.Boolean):
        return "categorical"
    if dtype in (pl.Date, pl.Datetime, pl.Time):
        return "temporal"
    if dtype.is_numeric() and n_unique <= CATEGORICAL_MAX_UNIQUE:
        return "categorical"
    return "continuous"


def _round(v):
    if isinstance(v, float):
        return round(v, 4)
    return v


def profile_column(series: pl.Series) -> dict:
    n_unique = series.n_unique()
    kind = _classify(series.dtype, n_unique)
    col = {
        "name": series.name,
        "dtype": str(series.dtype),
        "kind": kind,
        "nulls": int(series.null_count()),
        "n_unique": int(n_unique),
    }
    if kind == "categorical":
        vals = series.drop_nulls().unique().sort().to_list()[:MAX_DISTINCT_SHOWN]
        col["values"] = [str(v) for v in vals]
    elif kind == "temporal":
        col["min"] = str(series.min())
        col["max"] = str(series.max())
    else:
        try:
            col["min"] = _round(series.min())
            col["max"] = _round(series.max())
            col["mean"] = _round(series.mean())
            col["median"] = _round(series.median())
            col["std"] = _round(series.std())
        except Exception:
            # Non-summarisable numeric (all-null, mixed) — leave the stats off
            # rather than emit nonsense.
            pass
    return col


def profile_frame(df: pl.DataFrame, name: str, size: int) -> dict:
    cols = [profile_column(df[c]) for c in df.columns[:MAX_COLUMNS_DESCRIBED]]
    return {
        "name": name,
        "size_bytes": size,
        "rows": df.height,
        "n_columns": df.width,
        "columns": cols,
    }


def _read_bytes(name: str, raw: bytes) -> pl.DataFrame:
    suffix = Path(name).suffix.lower()
    buf = io.BytesIO(raw)
    if suffix == ".parquet":
        return pl.read_parquet(buf)
    if suffix in (".xlsx", ".xls"):
        return pl.read_excel(buf)
    if suffix == ".json":
        return pl.read_json(buf)
    sep = "\t" if suffix == ".tsv" else ","
    # try_parse_dates matters for the catalogue's main job: a date read as a
    # string profiles as a categorical with 700 "distinct values", which tells a
    # model nothing. Parsed, it profiles as temporal with a real min..max range —
    # which is what answers "sales for the last 2 months".
    return pl.read_csv(buf, separator=sep, infer_schema_length=10000, try_parse_dates=True)


async def fetch_and_profile(
    client: httpx.AsyncClient, host: str, site: str, token: str, f: dict
) -> dict:
    """Stream one dataset out of SharePoint and profile it."""
    sru = f["serverRelativeUrl"]
    url = (
        f"https://{host}{site}/_api/web/GetFileByServerRelativeUrl"
        f"('{quote(sru, safe='/')}')/$value"
    )
    buf = bytearray()
    async with client.stream(
        "GET", url, headers={"Authorization": f"Bearer {token}"}
    ) as r:
        if r.status_code != 200:
            body = await r.aread()
            raise RuntimeError(f"SharePoint read failed ({r.status_code}): {body[:200]!r}")
        async for chunk in r.aiter_bytes(1 << 20):
            buf.extend(chunk)
    df = _read_bytes(f["name"], bytes(buf))
    return profile_frame(df, f["name"], len(buf))


async def describe(
    client: httpx.AsyncClient, profile: dict, siblings: list[str]
) -> dict:
    """Ask the Azure describer for prose. Returns {} if it isn't configured."""
    svc = service_config()
    url, key = svc.get("url"), svc.get("key")
    if not url:
        return {"error": "catalog service not configured"}
    payload = dict(profile)
    payload["siblings"] = [s for s in siblings if s != profile["name"]]
    headers = {"Content-Type": "application/json"}
    if key:
        headers["x-functions-key"] = key
    r = await client.post(url, json={"dataset": payload}, headers=headers, timeout=120)
    if r.status_code != 200:
        return {"error": f"describer returned {r.status_code}: {r.text[:200]}"}
    return r.json()


def merge_entry(profile: dict, described: dict, fp: str) -> dict:
    cols_desc = {c["name"]: c["description"] for c in described.get("columns", [])}
    for c in profile["columns"]:
        if c["name"] in cols_desc:
            c["description"] = cols_desc[c["name"]]
    return {
        "fingerprint": fp,
        "name": profile["name"],
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
