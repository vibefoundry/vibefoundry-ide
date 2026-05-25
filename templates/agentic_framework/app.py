"""Receipt scanner: watch input_folder/agent_input/ and classify each receipt image.

The 7-step pipeline (see the framework diagram):

  1. Watch Receipts   — a new image lands in input_folder/agent_input/.
  2. Build Prompt     — prompt.build_prompt() assembles the instruction text.
  3. Send To OpenAI   — prompt.invoke_openai() uploads the image.
  4. OpenAI Scans     — the vision model returns a structured JSON record.
  5. Retry            — retry.run_with_retry() re-asks on a failed/empty scan.
  6. Parse            — parse.append_row() writes the record as a CSV row in
                        output_folder/classifications.csv.
  7. Export           — export.export_record() archives the image + a
                        per-receipt receipt.json under output_folder/scanned/.

Drop receipt images into input_folder/agent_input/ and the scanner picks them up.
Requires the `openai` SDK and an OPENAI_API_KEY environment variable.
"""

from __future__ import annotations

import sys
import threading
from pathlib import Path

import export as export_mod
import parse as parse_mod
import prompt as prompt_mod
import retry as retry_mod

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parents[2]
TASK_NAME = SCRIPT_DIR.name
INPUT_DIR = PROJECT_ROOT / "input_folder"
AGENT_INPUT_DIR = INPUT_DIR / "agent_input"
# All outputs live under the task's own folder: output_folder/{task}/
TASK_OUTPUT = PROJECT_ROOT / "output_folder" / TASK_NAME
CLASSIFICATIONS_CSV = TASK_OUTPUT / "classifications.csv"
LINE_ITEMS_CSV = TASK_OUTPUT / "line_items.csv"
SCANNED_DIR = TASK_OUTPUT / "scanned"

IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff", ".heic"}


def _worker_count() -> int:
    """How many receipts to scan in parallel. Override with IMAGE_SCANNER_WORKERS;
    defaults to 4. OpenAI calls are I/O-bound, so threads (not processes) are the
    right model — the GIL is released while each request waits on the network."""
    import os
    try:
        n = int(os.environ.get("IMAGE_SCANNER_WORKERS", "4"))
    except ValueError:
        n = 4
    return max(1, n)


# Concurrent worker threads each log progress; this lock keeps a thread's line
# from interleaving mid-write with another thread's.
_print_lock = threading.Lock()


def _log(receipt_id: str, msg: str) -> None:
    """Emit one atomic, receipt-tagged status line — safe under concurrency.
    The id is padded before coloring so ANSI codes don't skew the alignment."""
    with _print_lock:
        print(f"  {_dim(f'{receipt_id:<24}')} {msg}", flush=True)


def _is_image(path: Path) -> bool:
    return path.suffix.lower() in IMAGE_SUFFIXES and not path.name.startswith(".")


# ---------- core orchestration ----------

def scan(image_path: Path) -> dict | None:
    """Run the full pipeline for one receipt image. Returns the parsed record,
    or None if the scan failed after all retries. Safe to call from many
    worker threads at once — every status line goes through the atomic _log."""
    receipt_id = image_path.stem
    _log(receipt_id, "→ sending to OpenAI")

    # Steps 2-5: build the prompt, send the image to OpenAI, retry on failure.
    prompt_text = prompt_mod.build_prompt()
    record = retry_mod.run_with_retry(
        image_path,
        prompt_text,
        on_retry=lambda attempt, reason: _log(receipt_id, _dim(f"↻ retry {attempt}")),
        on_fail=lambda reason: _log(receipt_id, _red(f"✗ {reason}")),
    )

    if record is None:
        return None

    # Step 6: parse the JSON into a summary row + one row per line item.
    row = parse_mod.append_row(
        receipt_id, record, CLASSIFICATIONS_CSV, LINE_ITEMS_CSV
    )

    # Step 7: export the per-receipt deliverable folder.
    export_mod.export_record(receipt_id, image_path, record, SCANNED_DIR)

    conf = _dim(f"(conf {row['confidence']})")
    _log(
        receipt_id,
        f"{_cyan('✓')} {row['merchant']} · {row['date']} · "
        f"${row['total']} · {row['category']} · {row['item_count']} items {conf}",
    )
    return record


# ---------- agent_input watcher ----------

def _process_image(path: Path) -> None:
    if not _is_image(path):
        return
    try:
        scan(path)
    except Exception as e:
        _log(path.stem, _red(f"✗ error: {e}"))


def _watch_agent_input() -> None:
    import time
    from concurrent.futures import ThreadPoolExecutor

    try:
        from watchdog.events import FileSystemEventHandler
        from watchdog.observers import Observer
    except ImportError:
        print(
            "[image_scanner] missing dependency: watchdog\n"
            "  install with: pip install watchdog",
            file=sys.stderr,
        )
        sys.exit(1)

    AGENT_INPUT_DIR.mkdir(parents=True, exist_ok=True)
    TASK_OUTPUT.mkdir(parents=True, exist_ok=True)
    SCANNED_DIR.mkdir(parents=True, exist_ok=True)

    workers = _worker_count()
    seen: set[str] = set()
    seen_lock = threading.Lock()
    executor = ThreadPoolExecutor(max_workers=workers)

    def _claim(path: Path) -> bool:
        """Record a path as seen; return True only the first time."""
        with seen_lock:
            if str(path) in seen:
                return False
            seen.add(str(path))
            return True

    class _AgentInputHandler(FileSystemEventHandler):
        def on_created(self, event):
            if event.is_directory:
                return
            path = Path(event.src_path)
            if _is_image(path) and _claim(path):
                executor.submit(_process_image, path)

    observer = Observer()
    observer.schedule(_AgentInputHandler(), str(AGENT_INPUT_DIR), recursive=False)
    observer.start()

    print(f"[image_scanner] watching {AGENT_INPUT_DIR}")
    print(f"[image_scanner] summary  {CLASSIFICATIONS_CSV}")
    print(f"[image_scanner] items    {LINE_ITEMS_CSV}")
    print(f"[image_scanner] scanned  {SCANNED_DIR}")
    print(f"[image_scanner] workers  {workers} (scanning in parallel)")

    # Pick up any receipts already sitting in agent_input at startup.
    existing = sorted(p for p in AGENT_INPUT_DIR.iterdir() if _is_image(p))
    if existing:
        print(f"[image_scanner] found {len(existing)} image(s) already in agent_input")
        for path in existing:
            if _claim(path):
                executor.submit(_process_image, path)

    print("[image_scanner] drop receipt images into agent_input; Ctrl+C to stop\n")

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n[image_scanner] shutting down...")
    finally:
        observer.stop()
        observer.join()
        executor.shutdown(wait=True)


# ---------- terminal helpers ----------

def _supports_color() -> bool:
    import os
    return sys.stdout.isatty() and os.environ.get("NO_COLOR") is None


def _wrap(s: str, on: str, off: str = "\x1b[0m") -> str:
    return f"{on}{s}{off}" if _supports_color() else s


def _dim(s: str) -> str:    return _wrap(s, "\x1b[2m")
def _cyan(s: str) -> str:   return _wrap(s, "\x1b[36m")
def _red(s: str) -> str:    return _wrap(s, "\x1b[31m")


if __name__ == "__main__":
    _watch_agent_input()
