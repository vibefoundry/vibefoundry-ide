"""Step 7 of the pipeline: Export.

Parse (step 6) appends the receipt to the combined classifications.csv ledger.
Export produces the per-receipt deliverable: a folder under
output_folder/scanned/{receipt_id}/ holding a copy of the original receipt
image and a receipt.json with the extracted fields. That folder is the audit
trail for a single receipt — proof of what was scanned and what came back.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any


def export_record(
    receipt_id: str,
    image_path: Path,
    record: dict[str, Any],
    scanned_dir: Path,
) -> Path:
    """Write output_folder/scanned/{receipt_id}/ and return the folder path.

    The folder contains the source receipt image (copied, not moved — the
    input is left untouched) and receipt.json with the OpenAI extraction.
    """
    dest = scanned_dir / receipt_id
    dest.mkdir(parents=True, exist_ok=True)

    shutil.copy2(image_path, dest / image_path.name)
    (dest / "receipt.json").write_text(
        json.dumps(record, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    return dest
