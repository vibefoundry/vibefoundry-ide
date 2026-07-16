"""Server-side catalogue builder.

Reads the SharePoint library with an app-only Graph token, profiles every
dataset, has each described, and writes the finished catalogue to blob storage.
Users' apps then just fetch it — nobody clicks "build" and nobody waits.

Auth model: the daemon holds Graph `Sites.Selected` plus an explicit per-site
grant, so it can read exactly the sites it's been given and nothing else in the
tenant. That is deliberately narrower than Sites.Read.All.

Profiles are keyed on a size+lastModified fingerprint, so a scheduled run only
re-reads and re-describes datasets that actually changed.
"""

import io
import json
import os
import time
from pathlib import Path

import httpx
import polars as pl

GRAPH = "https://graph.microsoft.com/v1.0"

DATA_SUFFIXES = {".csv", ".tsv", ".parquet", ".xlsx", ".xls", ".json"}
MAX_COLUMNS_DESCRIBED = 50
MAX_DISTINCT_SHOWN = 25
CATEGORICAL_MAX_UNIQUE = 20
SHEET_SEP = " :: "


# --- Graph ------------------------------------------------------------------
def graph_token() -> str:
    tenant = os.environ["GRAPH_TENANT_ID"]
    r = httpx.post(
        f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
        data={
            "client_id": os.environ["GRAPH_CLIENT_ID"],
            "client_secret": os.environ["GRAPH_CLIENT_SECRET"],
            "scope": "https://graph.microsoft.com/.default",
            "grant_type": "client_credentials",
        },
        timeout=30,
    )
    r.raise_for_status()
    return r.json()["access_token"]


def list_datasets(client: httpx.Client, token: str, site: str, folder: str) -> list[dict]:
    """Data files under `folder`, recursing into subfolders."""
    h = {"Authorization": f"Bearer {token}"}
    found: list[dict] = []
    queue = [folder.strip("/")]
    seen = 0

    while queue and seen < 200:
        seen += 1
        rel = queue.pop(0)
        url = (
            f"{GRAPH}/sites/{site}/drive/root:/{rel}:/children"
            if rel
            else f"{GRAPH}/sites/{site}/drive/root/children"
        )
        r = client.get(url, headers=h, timeout=60)
        if r.status_code != 200:
            if not found:
                raise RuntimeError(f"Graph list failed ({r.status_code}): {r.text[:200]}")
            continue
        for item in r.json().get("value", []):
            name = item.get("name", "")
            if "folder" in item:
                queue.append(f"{rel}/{name}" if rel else name)
                continue
            if Path(name).suffix.lower() not in DATA_SUFFIXES:
                continue
            found.append({
                "name": name,
                "path": f"{rel}/{name}" if rel else name,
                "size": item.get("size"),
                "modified": item.get("lastModifiedDateTime"),
                "download_url": item.get("@microsoft.graph.downloadUrl"),
            })
    return found


def fingerprint(f: dict) -> str:
    return f"{f.get('size')}:{f.get('modified')}"


def fetch_bytes(client: httpx.Client, f: dict, token: str) -> bytes:
    # Graph hands back a pre-authenticated download URL; it needs no auth header
    # and (unlike SharePoint's REST $value) it honours Range.
    url = f.get("download_url")
    if url:
        r = client.get(url, timeout=600, follow_redirects=True)
    else:
        r = client.get(
            f"{GRAPH}/sites/{os.environ['CATALOG_SITE_ID']}/drive/root:/{f['path']}:/content",
            headers={"Authorization": f"Bearer {token}"}, timeout=600, follow_redirects=True,
        )
    r.raise_for_status()
    return r.content


# --- Profiling ---------------------------------------------------------------
def _classify(dtype: pl.DataType, n_unique: int) -> str:
    if dtype in (pl.Utf8, pl.String, pl.Categorical, pl.Boolean):
        return "categorical"
    if dtype in (pl.Date, pl.Datetime, pl.Time):
        return "temporal"
    if dtype.is_numeric() and n_unique <= CATEGORICAL_MAX_UNIQUE:
        return "categorical"
    return "continuous"


def _round(v):
    return round(v, 4) if isinstance(v, float) else v


def profile_column(s: pl.Series) -> dict:
    n_unique = s.n_unique()
    kind = _classify(s.dtype, n_unique)
    col = {
        "name": s.name, "dtype": str(s.dtype), "kind": kind,
        "nulls": int(s.null_count()), "n_unique": int(n_unique),
    }
    if kind == "categorical":
        col["values"] = [str(v) for v in s.drop_nulls().unique().sort().to_list()[:MAX_DISTINCT_SHOWN]]
    elif kind == "temporal":
        col["min"], col["max"] = str(s.min()), str(s.max())
    else:
        try:
            col.update({
                "min": _round(s.min()), "max": _round(s.max()),
                "mean": _round(s.mean()), "median": _round(s.median()),
                "std": _round(s.std()),
            })
        except Exception:
            pass
    return col


def read_frame(name: str, raw: bytes, sheet: str | None = None) -> pl.DataFrame:
    suffix = Path(name).suffix.lower()
    buf = io.BytesIO(raw)
    if suffix == ".parquet":
        return pl.read_parquet(buf)
    if suffix in (".xlsx", ".xls"):
        return pl.read_excel(buf, sheet_name=sheet) if sheet else pl.read_excel(buf)
    if suffix == ".json":
        return pl.read_json(buf)
    sep = "\t" if suffix == ".tsv" else ","
    # try_parse_dates so a date profiles as temporal with a real min..max range
    # rather than a categorical with hundreds of "distinct values".
    return pl.read_csv(buf, separator=sep, infer_schema_length=10000, try_parse_dates=True)


def excel_sheets(raw: bytes) -> list[str]:
    import openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(raw), read_only=True)
    try:
        return list(wb.sheetnames)
    finally:
        wb.close()


def profile_frame(df: pl.DataFrame, name: str, size: int) -> dict:
    return {
        "name": name, "size_bytes": size, "rows": df.height, "n_columns": df.width,
        "columns": [profile_column(df[c]) for c in df.columns[:MAX_COLUMNS_DESCRIBED]],
    }
