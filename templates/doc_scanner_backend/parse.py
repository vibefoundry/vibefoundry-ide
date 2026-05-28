"""Step 6 of the pipeline: Parse.

Turns the JSON record OpenAI returned into rows in a single CSV —
classifications.csv. Every row carries the full receipt summary
(location, date, state, city, scanned_at) AND one line item
(item, price, item_type). A receipt with N items produces N rows;
a receipt with no items produces a single row with blank line-item fields.

The summary fields repeat on every line — that's deliberate. It makes the
file self-describing: filter on item_type or date and every matching row
already carries its own location and state, no join required.
"""

from __future__ import annotations

import csv
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Summary fields repeat on every row; line-item fields fill in per row.
CSV_COLUMNS = [
    "receipt_id",
    "location",
    "date",
    "state",
    "city",
    "item_count",
    "scanned_at",
    "line_no",
    "item",
    "price",
    "item_type",
]

# Several scans run in parallel, so appends to the shared CSV must be
# serialized — otherwise two rows can interleave on disk.
_write_lock = threading.Lock()


def _append(csv_path: Path, columns: list[str], rows: list[dict[str, Any]]) -> None:
    """Append `rows` to a CSV, writing the header first if the file is new."""
    if not rows:
        return
    is_new = not csv_path.exists()
    with csv_path.open("a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=columns)
        if is_new:
            writer.writeheader()
        writer.writerows(rows)


def append_row(
    receipt_id: str,
    record: dict[str, Any],
    csv_path: Path,
) -> dict[str, Any]:
    """Append a receipt to classifications.csv and return the summary dict
    (per-receipt fields + computed total — used by the caller for log output).

    A receipt with N items writes N rows; one with no items writes a single
    row with blank line-item fields. All rows for one receipt are written
    under the shared lock so they land contiguously on disk.
    """
    items = record.get("items") or []

    summary = {
        "receipt_id": receipt_id,
        "location": record.get("location", ""),
        "date": record.get("date", ""),
        "state": record.get("state", ""),
        "city": record.get("city", ""),
        "item_count": len(items),
        "scanned_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }

    if items:
        rows = [
            {
                **summary,
                "line_no": i,
                "item": item.get("item", ""),
                "price": item.get("price", ""),
                "item_type": item.get("item_type", ""),
            }
            for i, item in enumerate(items, start=1)
        ]
    else:
        rows = [{**summary, "line_no": "", "item": "", "price": "", "item_type": ""}]

    with _write_lock:
        csv_path.parent.mkdir(parents=True, exist_ok=True)
        _append(csv_path, CSV_COLUMNS, rows)

    # Schema no longer carries a receipt-level total; compute one from items
    # for caller-side logging convenience.
    try:
        summary["total"] = round(sum(float(it.get("price", 0) or 0) for it in items), 2)
    except (TypeError, ValueError):
        summary["total"] = ""

    return summary
