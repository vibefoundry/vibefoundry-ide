"""Flask backend for receipts_app — wraps the image_scanner agent in HTTP.

Endpoints:
  POST /api/scan              multipart upload of N images; SSE stream emits one
                              event per receipt as it finishes scanning.
  GET  /api/receipts          one row per scanned receipt (computed from the
                              denormalized classifications.csv).
  GET  /api/line_items        every line item across every receipt (each row
                              also carries its receipt's location/date — the
                              CSV is already denormalized this way).
  GET  /api/receipts/<id>/items   line items for one receipt.
  GET  /api/image/<id>        serves the archived receipt image.
  GET  /api/health            sanity check.

Reuses the agent's role-named modules verbatim (prompt, retry, parse, export).
The backend is self-contained: uploads land in backend/document_input/, all
outputs land in backend/agent_results/. No external input_folder/output_folder
— the same convention doc_scanner_backend uses, so students can compare the two
templates side-by-side.
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
# Self-contained layout — same shape as doc_scanner_backend. Uploads come in
# through HTTP and land in document_input/ alongside any files dropped there
# manually; results land in agent_results/.
DOCUMENT_INPUT_DIR = SCRIPT_DIR / "document_input"
AGENT_RESULTS = SCRIPT_DIR / "agent_results"
SCANNED_DIR = AGENT_RESULTS / "scanned"
CLASSIFICATIONS_CSV = AGENT_RESULTS / "classifications.csv"

IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff", ".heic"}
WORKERS = max(1, int(os.environ.get("RECEIPTS_APP_WORKERS", "4")))

for d in (DOCUMENT_INPUT_DIR, SCANNED_DIR):
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
    while (SCANNED_DIR / candidate).exists() or (DOCUMENT_INPUT_DIR / f"{candidate}{Path(filename).suffix}").exists():
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

        summary = parse_mod.append_row(receipt_id, record, CLASSIFICATIONS_CSV)
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
    return jsonify({"status": "ok", "agent_results": str(AGENT_RESULTS)})


@app.route("/api/scan", methods=["POST"])
def scan_endpoint():
    """Multipart upload → SSE stream of per-receipt completion events.

    Frontend POSTs files, then reads the response as a stream. Each upload is
    saved into document_input/ (the same inbox a folder-drop intake would use,
    so the storage convention is identical to doc_scanner_backend), submitted to
    the thread pool, and yielded as an SSE event when the future completes —
    so the UI flips rows from 'scanning' → 'done' as each receipt finishes,
    not at the end of the whole batch.
    """
    uploads: list[tuple[Path, str]] = []  # (saved_path, receipt_id)
    for storage in request.files.getlist("files"):
        if not storage or not storage.filename:
            continue
        suffix = Path(storage.filename).suffix.lower()
        if suffix not in IMAGE_SUFFIXES:
            continue
        receipt_id = _safe_receipt_id(storage.filename)
        saved = DOCUMENT_INPUT_DIR / f"{receipt_id}{suffix}"
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


# ---------- read endpoints (all backed by the single denormalized CSV) -------

# Receipt-level columns in the unified CSV (everything except the per-line bits).
_RECEIPT_COLS = ["receipt_id", "location", "date", "state", "city",
                 "item_count", "scanned_at"]
# Per-line columns.
_ITEM_COLS = ["line_no", "item", "price", "item_type"]


@app.route("/api/receipts")
def list_receipts():
    """One row per scanned receipt with computed total spend.

    Reads the denormalized classifications.csv (one row per line item) and
    collapses to one row per receipt by taking the first per-receipt summary
    and summing the line-item prices.
    """
    if not CLASSIFICATIONS_CSV.exists():
        return jsonify({"receipts": []})

    import polars as pl

    df = pl.read_csv(CLASSIFICATIONS_CSV)
    if df.height == 0:
        return jsonify({"receipts": []})

    receipts = (
        df.group_by("receipt_id")
          .agg(
              *[pl.col(c).first().alias(c) for c in _RECEIPT_COLS if c != "receipt_id"],
              pl.col("price").cast(pl.Float64, strict=False).sum().alias("total"),
          )
          .to_dicts()
    )
    return jsonify({"receipts": receipts})


@app.route("/api/line_items")
def list_line_items():
    """Every line item across every receipt — the primary table view.

    The unified CSV is already denormalized (one row per line item, every row
    carries the receipt-level metadata), so this is a near-passthrough.
    """
    if not CLASSIFICATIONS_CSV.exists():
        return jsonify({"items": []})

    import polars as pl

    df = pl.read_csv(CLASSIFICATIONS_CSV)
    if df.height == 0:
        return jsonify({"items": []})

    # Filter out the placeholder row a no-item receipt produces (line_no="").
    df = df.filter(pl.col("line_no").cast(pl.Utf8, strict=False) != "")
    return jsonify({"items": df.to_dicts()})


@app.route("/api/receipts/<receipt_id>/items")
def receipt_items(receipt_id: str):
    if not CLASSIFICATIONS_CSV.exists():
        return jsonify({"items": []})

    import polars as pl

    df = (
        pl.read_csv(CLASSIFICATIONS_CSV)
          .filter(pl.col("receipt_id") == receipt_id)
          .filter(pl.col("line_no").cast(pl.Utf8, strict=False) != "")
    )
    return jsonify({"items": df.to_dicts()})


@app.route("/api/image/<receipt_id>")
def receipt_image(receipt_id: str):
    """Serve the archived receipt image. export_record writes it under
    agent_results/scanned/{receipt_id}/{filename}."""
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
    print(f"[receipts_app] backend  on http://localhost:{port}")
    print(f"[receipts_app] inbox    {DOCUMENT_INPUT_DIR}")
    print(f"[receipts_app] results  {CLASSIFICATIONS_CSV}")
    print(f"[receipts_app] scanned  {SCANNED_DIR}")
    print(f"[receipts_app] workers  {WORKERS}")
    # threaded=True so SSE streams don't block other requests on dev server.
    app.run(host="0.0.0.0", port=port, threaded=True, debug=False)
