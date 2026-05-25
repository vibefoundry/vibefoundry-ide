"""Flask backend for receipts_app — wraps the image_scanner agent in HTTP.

Endpoints:
  POST /api/scan              multipart upload of N images; SSE stream emits one
                              event per receipt as it finishes scanning.
  GET  /api/receipts          list of past receipts from classifications.csv
  GET  /api/receipts/<id>/items   line items for one receipt
  GET  /api/image/<id>        serves the archived receipt image
  GET  /api/health            sanity check

Reuses the agent's role-named modules verbatim (prompt, retry, parse, export).
All outputs land under output_folder/receipts_app/ so this app's data stays
separate from the standalone CLI scanner.
"""

from __future__ import annotations

import io
import json
import os
import queue
import re
import socket
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from flask import Flask, Response, jsonify, request, send_file
from flask_cors import CORS

# Agent modules — sit next to this file in backend/.
sys.path.insert(0, str(Path(__file__).parent))
import export as export_mod
import parse as parse_mod
import prompt as prompt_mod
import retry as retry_mod


SCRIPT_DIR = Path(__file__).resolve().parent
# Outputs live under the app's own root so the template is self-contained:
# {app_root}/output_folder/{task_name}/  — per the AGENTS.md rule that every
# task's outputs go under its own {task_name}/ subfolder, never bare.
APP_ROOT = SCRIPT_DIR.parent
TASK_NAME = APP_ROOT.name
TASK_OUTPUT = APP_ROOT / "output_folder" / TASK_NAME
UPLOAD_DIR = TASK_OUTPUT / "uploads"
SCANNED_DIR = TASK_OUTPUT / "scanned"
CLASSIFICATIONS_CSV = TASK_OUTPUT / "classifications.csv"
LINE_ITEMS_CSV = TASK_OUTPUT / "line_items.csv"

IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff", ".heic"}
WORKERS = max(1, int(os.environ.get("RECEIPTS_APP_WORKERS", "4")))

for d in (UPLOAD_DIR, SCANNED_DIR):
    d.mkdir(parents=True, exist_ok=True)


app = Flask(__name__)
CORS(app, origins=re.compile(r"^http://localhost:\d+$"))

# Shared pool — scans are I/O bound on the OpenAI call.
_pool = ThreadPoolExecutor(max_workers=WORKERS)


def _safe_receipt_id(filename: str) -> str:
    """Strip the extension, sanitize, ensure uniqueness against existing scans."""
    stem = Path(filename).stem or "receipt"
    stem = re.sub(r"[^A-Za-z0-9_-]+", "_", stem).strip("_") or "receipt"
    candidate = stem
    n = 1
    while (SCANNED_DIR / candidate).exists() or (UPLOAD_DIR / f"{candidate}{Path(filename).suffix}").exists():
        n += 1
        candidate = f"{stem}_{n}"
    return candidate


def _scan_one(image_path: Path, receipt_id: str) -> dict:
    """Run the full per-receipt pipeline. Returns a dict suitable for the SSE
    event payload — either a success record or an error marker."""
    try:
        prompt_text = prompt_mod.build_prompt()
        record = retry_mod.run_with_retry(image_path, prompt_text)
        if record is None:
            return {"receipt_id": receipt_id, "status": "error", "error": "scan failed after retries"}

        summary = parse_mod.append_row(
            receipt_id, record, CLASSIFICATIONS_CSV, LINE_ITEMS_CSV
        )
        export_mod.export_record(receipt_id, image_path, record, SCANNED_DIR)

        return {
            "receipt_id": receipt_id,
            "status": "done",
            "summary": summary,
            "items": [
                {
                    "line_no": i,
                    "item": it.get("item", ""),
                    "price": it.get("price", 0),
                    "item_type": it.get("item_type", ""),
                }
                for i, it in enumerate(record.get("items") or [], start=1)
            ],
        }
    except Exception as e:
        return {"receipt_id": receipt_id, "status": "error", "error": str(e)}


def _sse(event: str, data: dict) -> str:
    """Format one Server-Sent Event frame."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@app.route("/api/health")
def health():
    return jsonify({"status": "ok", "task_output": str(TASK_OUTPUT)})


@app.route("/api/scan", methods=["POST"])
def scan_endpoint():
    """Multipart upload → SSE stream of per-receipt completion events.

    Frontend POSTs files, then reads the response as a stream. We save each
    upload to disk, submit it to the thread pool, and yield SSE events as
    futures complete — so the user sees rows flip from 'scanning' → 'done'
    as each receipt finishes, not at the end of the whole batch.
    """
    uploads: list[tuple[Path, str]] = []  # (saved_path, receipt_id)
    for storage in request.files.getlist("files"):
        if not storage or not storage.filename:
            continue
        suffix = Path(storage.filename).suffix.lower()
        if suffix not in IMAGE_SUFFIXES:
            continue
        receipt_id = _safe_receipt_id(storage.filename)
        saved = UPLOAD_DIR / f"{receipt_id}{suffix}"
        storage.save(saved)
        uploads.append((saved, receipt_id))

    if not uploads:
        return jsonify({"error": "no image files in upload"}), 400

    # Submit all uploads to the pool, then drain futures as they complete.
    # We use a queue rather than as_completed() so the generator can yield
    # immediately without blocking on the pool's internal locking semantics.
    results_q: queue.Queue = queue.Queue()

    def _run(path: Path, rid: str) -> None:
        results_q.put(_scan_one(path, rid))

    for path, rid in uploads:
        _pool.submit(_run, path, rid)

    def _stream():
        # Announce the batch up front so the UI can render placeholder rows.
        yield _sse("batch_started", {
            "receipts": [{"receipt_id": rid, "filename": p.name} for p, rid in uploads],
        })
        remaining = len(uploads)
        while remaining > 0:
            result = results_q.get()
            yield _sse("receipt_done", result)
            remaining -= 1
        yield _sse("batch_complete", {"count": len(uploads)})

    return Response(_stream(), mimetype="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
    })


# ---------- read endpoints ----------

@app.route("/api/receipts")
def list_receipts():
    """All scanned receipts, plus their item counts and total spend."""
    if not CLASSIFICATIONS_CSV.exists():
        return jsonify({"receipts": []})

    import polars as pl

    receipts = pl.read_csv(CLASSIFICATIONS_CSV).to_dicts()

    totals: dict[str, float] = {}
    if LINE_ITEMS_CSV.exists():
        items = pl.read_csv(LINE_ITEMS_CSV)
        if items.height > 0:
            grouped = (
                items.group_by("receipt_id")
                     .agg(pl.col("price").sum().alias("total"))
                     .to_dicts()
            )
            totals = {row["receipt_id"]: float(row["total"]) for row in grouped}

    for r in receipts:
        r["total"] = totals.get(r["receipt_id"], 0.0)

    return jsonify({"receipts": receipts})


@app.route("/api/line_items")
def list_line_items():
    """Every line item across every receipt — the primary table view."""
    if not LINE_ITEMS_CSV.exists():
        return jsonify({"items": []})

    import polars as pl

    items = pl.read_csv(LINE_ITEMS_CSV)
    if items.height == 0:
        return jsonify({"items": []})

    # Join receipt-level metadata (location, date) so the table can show
    # which store/date each line belongs to without a second fetch.
    if CLASSIFICATIONS_CSV.exists():
        receipts = pl.read_csv(CLASSIFICATIONS_CSV).select(
            ["receipt_id", "location", "date"]
        )
        items = items.join(receipts, on="receipt_id", how="left")

    return jsonify({"items": items.to_dicts()})


@app.route("/api/receipts/<receipt_id>/items")
def receipt_items(receipt_id: str):
    if not LINE_ITEMS_CSV.exists():
        return jsonify({"items": []})

    import polars as pl

    items = pl.read_csv(LINE_ITEMS_CSV).filter(pl.col("receipt_id") == receipt_id)
    return jsonify({"items": items.to_dicts()})


@app.route("/api/image/<receipt_id>")
def receipt_image(receipt_id: str):
    """Serve the archived receipt image. export_record writes it under
    output_folder/{task}/scanned/{receipt_id}/{filename}."""
    folder = SCANNED_DIR / receipt_id
    if not folder.exists():
        return jsonify({"error": "receipt not found"}), 404
    for p in folder.iterdir():
        if p.suffix.lower() in IMAGE_SUFFIXES:
            return send_file(p)
    return jsonify({"error": "no image archived for this receipt"}), 404


def _find_free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


if __name__ == "__main__":
    port = int(os.environ.get("BACKEND_PORT") or _find_free_port())
    print(f"[receipts_app] backend on http://localhost:{port}")
    print(f"[receipts_app] output: {TASK_OUTPUT}")
    print(f"[receipts_app] workers: {WORKERS}")
    # threaded=True so SSE streams don't block other requests on dev server.
    app.run(host="0.0.0.0", port=port, threaded=True, debug=False)
