"""Step 6 of the pipeline: Parse.

Turns the JSON record OpenAI returned into CSV rows. A receipt has two levels
of data, so it lands in two files:

  * classifications.csv — one row per receipt: the summary (location, date,
    state, city, how many items).
  * line_items.csv      — one row per purchased item: the item description,
    price, and item_type. Joinable back to the summary on `receipt_id`.

Both are appended to, so they grow into a running ledger of everything scanned.
"""

from __future__ import annotations

import csv
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# One row per receipt.
CSV_COLUMNS = [
    "receipt_id",
    "location",
    "date",
    "state",
    "city",
    "item_count",
    "scanned_at",
]

# One row per line item; `receipt_id` joins back to CSV_COLUMNS.
LINE_ITEM_COLUMNS = [
    "receipt_id",
    "line_no",
    "item",
    "price",
    "item_type",
]

# Several scans run in parallel, so appends to the shared CSVs must be
# serialized — otherwise two rows can interleave on disk. One lock covers both
# files so a receipt's summary and its line items are written as a unit.
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
    line_items_path: Path,
) -> dict[str, Any]:
    """Append one receipt to classifications.csv and its items to
    line_items.csv. Returns the summary row written.
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

    item_rows = [
        {
            "receipt_id": receipt_id,
            "line_no": i,
            "item": item.get("item", ""),
            "price": item.get("price", ""),
            "item_type": item.get("item_type", ""),
        }
        for i, item in enumerate(items, start=1)
    ]

    with _write_lock:
        csv_path.parent.mkdir(parents=True, exist_ok=True)
        _append(csv_path, CSV_COLUMNS, [summary])
        _append(line_items_path, LINE_ITEM_COLUMNS, item_rows)

    return summary
