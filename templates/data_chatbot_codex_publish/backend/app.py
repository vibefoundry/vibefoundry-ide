"""Flask backend for data_chatbot_codex — the code-gen chatbot over 3YR_Data.parquet.

Orchestrator (Track 4 sense): composes the role-named stages for each question,
exposed over HTTP. It never does data work itself — it calls into the modules:

  prompt    -> build prompts + invoke `codex exec` (classify, codegen, final answer)
  parse     -> farm code / prose / error from the codegen reply
  execute   -> run the code in an isolated subprocess -> result.parquet
  retry     -> the codegen <-> execute feedback loop
  export    -> write the per-question deliverable folder
  history   -> conversation memory + selection (recency floor + classify picks)
  metadata  -> the dataset profile sent to the model (never the data)

Endpoints:
  POST /api/ask           {question} -> SSE stream of stage/code/answer events
  GET  /api/metadata      the dataset profile (for the UI schema panel)
  GET  /api/history       prior turns in this conversation
  POST /api/reset         clear the conversation history
  GET  /api/result/<id>   preview rows of a question's result.parquet
  GET  /api/health        sanity check

Outputs land under `output/` inside the app folder — the chatbot is fully
self-contained (data/, output/, backend/, frontend/ all live below
app_folder/scripts/data_chatbot_codex/), deliberately departing from the project's
input_folder/ + output_folder/ convention.
"""

from __future__ import annotations

import json
import os
import re
import socket
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, Response, jsonify, request, send_file, send_from_directory
from flask_cors import CORS

# Agent modules — sit next to this file in backend/.
sys.path.insert(0, str(Path(__file__).parent))
import execute as execute_mod
import export as export_mod
import history as history_mod
import metadata as metadata_mod
import prompt as prompt_mod
import retry as retry_mod

import shutil
import subprocess
import threading
import time
from contextlib import contextmanager

import polars as pl

SCRIPT_DIR = Path(__file__).resolve().parent
# backend/ -> data_chatbot_codex/ — everything the app needs (data/, output/,
# frontend/, the launcher scripts) lives below APP_DIR. The app does not
# touch the project-wide input_folder/ or output_folder/.
APP_DIR = SCRIPT_DIR.parent
TASK_OUTPUT = APP_DIR / "output"
TASK_OUTPUT.mkdir(parents=True, exist_ok=True)

_PREVIEW_ROWS = 200  # cap rows returned to the UI table

app = Flask(__name__)
# No MAX_CONTENT_LENGTH set — uploads are uncapped. Local-only app, the user
# is uploading their own file from the same machine, so the only real ceiling
# is browser/Flask memory while the request streams to disk.
CORS(app, origins=re.compile(r"^http://localhost:\d+$"))

# Conversation memory (history.json + embeddings sidecar) lives in history.py.


def _new_question_id() -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    return f"{stamp}_{uuid.uuid4().hex[:6]}"


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@contextmanager
def timed(label: str, qid: str | None = None):
    """Stage timer: prints `[t qid=<id>] <label>: <seconds>s` to stderr on exit
    so we can see which phase of /api/ask is slow without a logging framework.
    The dev server runs threaded=True, so `qid` keeps overlapping requests'
    log lines distinguishable."""
    t0 = time.perf_counter()
    try:
        yield
    finally:
        dt = time.perf_counter() - t0
        prefix = f"[t qid={qid}]" if qid else "[t]"
        print(f"{prefix} {label}: {dt:.2f}s", file=sys.stderr, flush=True)


def _cleanup_empty_dir(path: Path) -> None:
    """Remove `path` if it exists and is empty. A failed code-gen run leaves an
    empty question dir behind because execute.py pre-creates it to hold
    result.parquet — but no result was written, so don't orphan it in the main
    folder (the failed run is recorded under failed/<question_id>/ instead)."""
    try:
        if path.is_dir() and not any(path.iterdir()):
            path.rmdir()
    except OSError:
        pass


# ---------- the orchestration, as an SSE generator ----------

def _answer_stream(question: str):
    """Run the full pipeline for one question, yielding SSE frames as it goes."""
    question_id = _new_question_id()
    question_dir = TASK_OUTPUT / question_id

    try:
        # 1. classify — code needed, or answerable from metadata alone? In the
        #    same call, classify also picks `relevant_history` + `include_code_for`
        #    from the full history; history.resolve_selection adds the recency
        #    floor and produces the (relevant_ids, include_code_for_ids) tuple
        #    that codegen and answer both consume.
        yield _sse("stage", {"stage": "classifying"})
        with timed("classify", qid=question_id):
            decision = prompt_mod.run_classify(question)
        history_selection = history_mod.resolve_selection(decision, history_mod.load())

        if not decision["needs_code"]:
            # Stream the answer rather than letting classify write it in JSON
            # mode — same streaming UX as the code-bearing branch. Classify is
            # decision-only; prose generation is always run_answer_stream's job.
            yield _sse("stage", {"stage": "answering"})
            parts: list[str] = []
            with timed("answer_stream", qid=question_id):
                # result_preview=None -> the answer prompt drops the COMPUTED
                # RESULT section entirely so the model has nothing to quote
                # back as "I have no preview numbers to cite."
                for token in prompt_mod.run_answer_stream(
                    question, None, history_selection,
                ):
                    parts.append(token)
                    yield _sse("answer_delta", {"text": token})
            answer = "".join(parts)
            export_mod.export_question(
                question_dir, question, answer, needs_code=False
            )
            history_mod.append_turn(question, answer, needs_code=False,
                                    question_id=question_id)
            yield _sse("answer", {
                "question_id": question_id,
                "needs_code": False,
                "answer": answer,
                "has_result": False,
            })
            yield _sse("done", {"question_id": question_id})
            return

        # 2. codegen <-> execute loop
        yield _sse("stage", {"stage": "generating_code"})
        result_path = question_dir / "result.parquet"
        with timed("retry_total", qid=question_id):
            outcome = retry_mod.run_codegen_with_retry(
                question, metadata_mod.get_tables(), result_path, history_selection,
            )

        if not outcome["ok"]:
            err = outcome["error"]
            failed_dir = TASK_OUTPUT / "failed" / question_id
            export_mod.export_failure(
                failed_dir, question,
                attempts_log=outcome.get("attempts_log", []),
            )
            # execute.py pre-created question_dir for result.parquet; on failure
            # it's empty — keep failed runs out of the main folder.
            _cleanup_empty_dir(question_dir)
            yield _sse("error", {
                "question_id": question_id,
                "error": err,
                "code": outcome.get("code", ""),
                "attempts": outcome.get("attempts"),
                "failed_dir": f"failed/{question_id}",
            })
            return

        # surface the code that ran
        yield _sse("code", {
            "code": outcome["code"],
            "description": outcome["prose"],
            "attempts": outcome["attempts"],
        })

        # 3. final verbal answer from the executed result — streamed token by token
        yield _sse("stage", {"stage": "answering"})
        with timed("result_preview", qid=question_id):
            preview_text = execute_mod.result_preview(result_path)
        parts: list[str] = []
        with timed("answer_stream", qid=question_id):
            for token in prompt_mod.run_answer_stream(question, preview_text, history_selection):
                parts.append(token)
                yield _sse("answer_delta", {"text": token})
        answer = "".join(parts)

        export_mod.export_question(
            question_dir, question, answer, needs_code=True,
            code=outcome["code"], description=outcome["prose"],
            attempts=outcome["attempts"],
        )
        # Recovered run: save the attempts that failed before the successful one.
        if outcome.get("attempts_log"):
            export_mod.export_failure(
                TASK_OUTPUT / "failed" / question_id, question,
                attempts_log=outcome["attempts_log"], resolved=True,
            )
        history_mod.append_turn(question, answer, needs_code=True,
                                question_id=question_id, description=outcome["prose"])

        table = _result_table(result_path)
        yield _sse("answer", {
            "question_id": question_id,
            "needs_code": True,
            "answer": answer,
            "code": outcome["code"],
            "description": outcome["prose"],
            "has_result": True,
            "columns": table["columns"],
            "rows": table["rows"],
            "total_rows": table["total_rows"],
        })
        yield _sse("done", {"question_id": question_id})

    except prompt_mod.CodexAuthError as e:
        # Codex's session is expired — surface a structured error code so the
        # frontend opens the re-auth modal instead of showing the raw stderr.
        # The frontend remembers `question` and re-sends it after the modal's
        # `codex login` subprocess completes successfully.
        yield _sse("error", {
            "question_id": question_id,
            "error": str(e),
            "error_code": "codex_auth_expired",
            "question": question,
        })
    except Exception as e:  # noqa: BLE001 — surface any stage failure to the UI
        yield _sse("error", {"question_id": question_id, "error": str(e)})


def _result_table(result_path: Path) -> dict:
    """Read a capped preview of result.parquet into JSON-friendly rows."""
    total = pl.scan_parquet(result_path).select(pl.len()).collect(engine="streaming").item()
    head = pl.read_parquet(result_path).head(_PREVIEW_ROWS)
    return {
        "columns": head.columns,
        "rows": head.rows(),  # list of tuples -> JSON arrays
        "total_rows": int(total),
    }


# ---------- routes ----------

# Serialize codex-login attempts: a double-click on the modal button would
# otherwise spawn two `codex login` subprocesses, the second of which would
# fight the first over the loopback port codex uses to receive the OAuth
# redirect. The lock collapses concurrent attempts into one shared wait.
_codex_login_lock = threading.Lock()
# 5-minute ceiling: covers a leisurely OAuth click-through and still cleans up
# if the user closes the browser tab without completing.
_CODEX_LOGIN_TIMEOUT = 300


@app.route("/api/auth/codex/login", methods=["POST"])
def codex_login():
    """Run `codex login` interactively from the backend so the frontend modal
    can offer a one-click re-auth flow.

    `codex login` opens the user's default browser to OpenAI's OAuth page and
    starts a local loopback listener for the redirect — no TTY required. The
    subprocess blocks until OAuth completes (or the user closes the browser),
    then exits 0 on success. We surface success/failure to the modal.

    Returns:
      200 {"ok": true}                          on a clean OAuth completion
      503 {"ok": false, "error": "..."}         on subprocess failure / timeout
      409 {"ok": false, "error": "already in progress"}  on concurrent click
    """
    # Resolve the FULL path (codex.cmd on Windows) and pass that to subprocess —
    # passing the bare name "codex" makes Windows' CreateProcess fail with
    # WinError 2 (it doesn't do PATH+PATHEXT resolution for a bare name, and
    # can't exec the .cmd shim directly). Same fix as the codegen path in prompt.py.
    codex_path = shutil.which("codex")
    if not codex_path:
        return jsonify({
            "ok": False,
            "error": "codex CLI not found on PATH. Install OpenAI Codex CLI and relaunch the app.",
        }), 503

    acquired = _codex_login_lock.acquire(blocking=False)
    if not acquired:
        return jsonify({
            "ok": False,
            "error": "a codex login is already in progress — finish that one first",
        }), 409
    try:
        try:
            proc = subprocess.run(
                [codex_path, "login"],
                capture_output=True,
                text=True,
                timeout=_CODEX_LOGIN_TIMEOUT,
                check=False,
            )
        except subprocess.TimeoutExpired:
            return jsonify({
                "ok": False,
                "error": "codex login did not finish within 5 minutes — close the browser tab and try again.",
            }), 503

        if proc.returncode != 0:
            stderr_snip = (proc.stderr or proc.stdout or "").strip()[:500]
            return jsonify({
                "ok": False,
                "error": f"codex login failed: {stderr_snip}",
            }), 503

        return jsonify({"ok": True})
    finally:
        _codex_login_lock.release()


@app.route("/api/health")
def health():
    tables = metadata_mod.get_tables()
    return jsonify({
        "status": "ok",
        "has_tables": bool(tables),
        "tables": [{"name": name, "file": p.name} for name, p in tables.items()],
        "task_output": str(TASK_OUTPUT),
    })


@app.route("/api/metadata")
def get_metadata():
    """Multi-table dataset profile (columns, dtypes, value samples, join keys).
    Cached by metadata.py on the manifest of (filename, mtime) pairs."""
    if not metadata_mod.has_any_table():
        return jsonify({"empty": True})
    try:
        return jsonify(metadata_mod.ensure_metadata())
    except Exception as e:  # noqa: BLE001
        return jsonify({"error": str(e)}), 500


@app.route("/api/tables")
def list_tables():
    """Roster of currently loaded tables for the UI. Uses cached metadata when
    available so the row/column counts are accurate."""
    tables_paths = metadata_mod.get_tables()
    if not tables_paths:
        return jsonify({"tables": []})
    try:
        meta = metadata_mod.ensure_metadata()
        return jsonify({"tables": [
            {"name": t["name"], "file": t["file"],
             "row_count": t["row_count"], "column_count": t["column_count"]}
            for t in meta["tables"]
        ]})
    except Exception:  # noqa: BLE001 — fall back to bare filenames
        return jsonify({"tables": [
            {"name": name, "file": p.name, "row_count": None, "column_count": None}
            for name, p in tables_paths.items()
        ]})


@app.route("/api/tables/<name>", methods=["DELETE"])
def delete_table_route(name: str):
    """Remove one table by name. Clears history (schema changed)."""
    if not re.fullmatch(r"[A-Za-z0-9_\-. ]+", name):
        return jsonify({"error": "bad table name"}), 400
    if not metadata_mod.delete_table(name):
        return jsonify({"error": "table not found"}), 404
    history_mod.reset()
    return jsonify({"status": "deleted", "name": name})


def _filter_config(table_meta: dict) -> dict:
    """Per-column filter widget descriptor for the Excel-style header menus.
    Low-card categoricals -> checkbox value list; high-card strings -> text
    contains; numerics -> min/max range. Takes one table's profile."""
    cfg = {}
    for c in table_meta["columns"]:
        if c["kind"] == "numeric":
            cfg[c["name"]] = {"type": "range", "min": c["min"], "max": c["max"]}
        elif c["kind"] == "categorical":
            cfg[c["name"]] = {"type": "values", "options": c["values"]}
        else:  # categorical_high
            cfg[c["name"]] = {"type": "text"}
    return cfg


def _apply_filters(lf: pl.LazyFrame, schema, filters: dict) -> pl.LazyFrame:
    """Apply the active Excel-style filters as lazy predicates (pushed down to
    the parquet scan)."""
    for name, f in (filters or {}).items():
        if name not in schema or not isinstance(f, dict):
            continue
        kind = f.get("type")
        if kind == "values":
            vals = f.get("values")
            if vals:  # empty/None -> no constraint
                lf = lf.filter(pl.col(name).is_in(vals))
        elif kind == "text":
            txt = (f.get("text") or "").strip()
            if txt:
                lf = lf.filter(
                    pl.col(name).cast(pl.Utf8).str.contains("(?i)" + re.escape(txt))
                )
        elif kind == "range":
            lo, hi = f.get("min"), f.get("max")
            if lo is not None:
                lf = lf.filter(pl.col(name) >= lo)
            if hi is not None:
                lf = lf.filter(pl.col(name) <= hi)
    return lf


@app.route("/api/preview", methods=["GET", "POST"])
def get_preview():
    """Rows of one table for the data grid. The active table is chosen by:
      1. the `table` field in the POST body (or `?table=` query param), if it
         names a loaded table, otherwise
      2. the first table alphabetically.
    Unfiltered is instant (parquet n_rows + cached stats); filtered (POST
    {filters}) runs the filters server-side and recomputes the stats strip."""
    if not metadata_mod.has_any_table():
        return jsonify({"empty": True})
    try:
        meta = metadata_mod.ensure_metadata()
        tables_paths = metadata_mod.get_tables()
        body = request.get_json(silent=True) or {}
        requested = body.get("table") or request.args.get("table")
        if requested and requested in tables_paths:
            table_name = requested
        else:
            table_name = next(iter(tables_paths))   # alphabetical first
        table_meta = next(t for t in meta["tables"] if t["name"] == table_name)
        data_path = tables_paths[table_name]

        filters = body.get("filters") or {} if request.method == "POST" else {}

        if filters:
            lf = pl.scan_parquet(data_path)
            schema = lf.collect_schema()
            lf = _apply_filters(lf, schema, filters)
            stats, total = metadata_mod.stats_for(lf)
            head = lf.head(_PREVIEW_ROWS).collect(engine="streaming")
            columns, rows = head.columns, head.rows()
        else:
            head = pl.read_parquet(data_path, n_rows=_PREVIEW_ROWS)
            columns, rows = head.columns, head.rows()
            stats = {c["name"]: c["stats"] for c in table_meta["columns"]}
            total = table_meta["row_count"]

        return jsonify({
            "table_name": table_name,
            "source_file": table_meta["file"],
            "total_rows": total,
            "column_count": table_meta["column_count"],
            "columns": columns,
            "rows": rows,
            "stats": stats,
            "filters_config": _filter_config(table_meta),
            # Full roster for the table-tab UI to render against.
            "tables_meta": [
                {"name": t["name"], "file": t["file"],
                 "row_count": t["row_count"], "column_count": t["column_count"]}
                for t in meta["tables"]
            ],
        })
    except Exception as e:  # noqa: BLE001
        return jsonify({"error": str(e)}), 500


@app.route("/api/history")
def get_history():
    return jsonify({"history": history_mod.load()})


@app.route("/api/reset", methods=["POST"])
def reset_history():
    history_mod.reset()
    return jsonify({"status": "cleared"})


@app.route("/api/upload", methods=["POST"])
def upload_dataset():
    """Add or replace tables in data/. Accepts one OR many parquet files in a
    single multipart request (input name `file`, repeated). Each file becomes
    a table named after its filename (minus `.parquet`). Re-uploading the same
    filename replaces that table; other tables are untouched.

    Conversation history is cleared on any successful upload — the schema may
    have changed and prior turns could reference columns that no longer exist.
    """
    files = request.files.getlist("file")
    if not files:
        return jsonify({"error": "no files provided"}), 400

    metadata_mod.APP_DATA_DIR.mkdir(parents=True, exist_ok=True)
    saved: list[dict] = []
    for f in files:
        if not f.filename:
            continue
        # Take just the basename to defang any path components in the upload.
        safe_name = os.path.basename(f.filename)
        if not safe_name.lower().endswith(".parquet"):
            return jsonify({"error": f"{safe_name or '(no name)'}: only .parquet files are supported"}), 400
        stem = Path(safe_name).stem
        if not stem:
            return jsonify({"error": f"{safe_name}: filename must have a name before .parquet"}), 400

        tmp_path = metadata_mod.APP_DATA_DIR / f"{safe_name}.tmp"
        final_path = metadata_mod.APP_DATA_DIR / safe_name

        # Stream to tmp, validate, then atomically swap into place so an
        # in-flight chat request never sees a half-written parquet.
        f.save(str(tmp_path))
        try:
            pl.scan_parquet(tmp_path).collect_schema()
        except Exception as e:  # noqa: BLE001
            tmp_path.unlink(missing_ok=True)
            return jsonify({"error": f"{safe_name}: not a valid parquet ({e})"}), 400

        if final_path.exists():
            final_path.unlink()
        tmp_path.rename(final_path)
        saved.append({"name": stem, "file": safe_name})

    if not saved:
        return jsonify({"error": "no valid files in upload"}), 400

    # Schema changed -> reset conversation so prior turns can't confuse classify.
    history_mod.reset()

    # Force-rebuild metadata so /api/preview / /api/metadata see the new set
    # without waiting for the next chat request.
    meta = metadata_mod.ensure_metadata(force=True)
    return jsonify({
        "status": "ok",
        "saved": saved,
        "table_count": meta["table_count"],
        "total_rows": meta["total_rows"],
    })


@app.route("/api/ask", methods=["POST"])
def ask():
    if not metadata_mod.has_any_table():
        return jsonify({"error": "no tables loaded — upload at least one parquet first"}), 400
    payload = request.get_json(silent=True) or {}
    question = (payload.get("question") or "").strip()
    if not question:
        return jsonify({"error": "question is required"}), 400
    return Response(_answer_stream(question), mimetype="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
    })


@app.route("/api/result/<question_id>")
def get_result(question_id: str):
    """Preview rows of a past question's result.parquet."""
    if not re.fullmatch(r"[A-Za-z0-9_]+", question_id):
        return jsonify({"error": "bad id"}), 400
    result_path = TASK_OUTPUT / question_id / "result.parquet"
    if not result_path.exists():
        return jsonify({"error": "no result for this question"}), 404
    return jsonify(_result_table(result_path))


@app.route("/api/result/<question_id>/download")
def download_result(question_id: str):
    if not re.fullmatch(r"[A-Za-z0-9_]+", question_id):
        return jsonify({"error": "bad id"}), 400
    result_path = TASK_OUTPUT / question_id / "result.parquet"
    if not result_path.exists():
        return jsonify({"error": "no result for this question"}), 404
    return send_file(result_path, as_attachment=True,
                     download_name=f"{question_id}_result.parquet")


# --- Published (single-server) mode ------------------------------------------
# When publish.py has built the frontend, it lands at application_core/frontend_dist
# (i.e. APP_DIR/frontend_dist). If present, Flask serves it so the whole app runs
# from ONE server on ONE port — no Vite, no proxy, no concurrently. In dev this
# folder is absent, so these routes 404 and Vite serves the frontend instead.
FRONTEND_DIST = APP_DIR / "frontend_dist"


@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_frontend(path: str):
    # /api/* is handled by the explicit routes above (they outrank this catch-all
    # in Flask's URL map); this guard just makes an unknown /api/... return JSON
    # 404 rather than the SPA shell.
    if path.startswith("api/"):
        return jsonify({"error": "not found"}), 404
    if not FRONTEND_DIST.exists():
        return jsonify({"error": "frontend not built — run publish.py"}), 404
    candidate = FRONTEND_DIST / path
    if path and candidate.is_file():
        return send_from_directory(FRONTEND_DIST, path)
    # SPA fallback: any unmatched path serves index.html.
    return send_from_directory(FRONTEND_DIST, "index.html")


def _find_free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


# --- Published-mode lifecycle: heartbeat watchdog + single-instance portfile ---
# Active only when launched by the published run_app.* (which sets VF_PUBLISHED=1).
# The frontend POSTs /api/heartbeat on a timer; if none arrives for the grace
# window — e.g. the user closed the last tab — the silently-running server shuts
# itself down so background instances don't pile up. The portfile lets the
# launcher detect an already-running instance and reuse it. In dev (flag unset)
# none of this runs, so the dev server behaves exactly as before.
_PUBLISHED = os.environ.get("VF_PUBLISHED") == "1"
# Grace window before a heartbeat-less server self-terminates. 90s comfortably
# exceeds browsers' ~60s background-tab timer throttling, so a merely-backgrounded
# tab won't be mistaken for a closed one. Overridable for tuning/tests.
_HEARTBEAT_GRACE_SECONDS = int(os.environ.get("VF_HEARTBEAT_GRACE", "90"))
_PORTFILE = APP_DIR / ".server_port"
_last_heartbeat = time.time()
_heartbeat_lock = threading.Lock()


@app.route("/api/heartbeat", methods=["POST"])
def heartbeat():
    global _last_heartbeat
    with _heartbeat_lock:
        _last_heartbeat = time.time()
    return ("", 204)


def _watchdog() -> None:
    """Self-terminate if no heartbeat has arrived within the grace window."""
    while True:
        time.sleep(5)
        with _heartbeat_lock:
            idle = time.time() - _last_heartbeat
        if idle > _HEARTBEAT_GRACE_SECONDS:
            try:
                _PORTFILE.unlink(missing_ok=True)
            except OSError:
                pass
            os._exit(0)


if __name__ == "__main__":
    port = int(os.environ.get("BACKEND_PORT") or _find_free_port())
    print(f"[data_chatbot_codex] backend on http://localhost:{port}")
    table_names = list(metadata_mod.get_tables().keys())
    print(f"[data_chatbot_codex] tables: {table_names or '(none — awaiting upload)'}")
    print(f"[data_chatbot_codex] output: {TASK_OUTPUT}")
    if _PUBLISHED:
        import atexit
        try:
            _PORTFILE.write_text(str(port), encoding="utf-8")
        except OSError:
            pass
        atexit.register(lambda: _PORTFILE.unlink(missing_ok=True))
        threading.Thread(target=_watchdog, daemon=True).start()
        print(f"[data_chatbot_codex] published mode: watchdog on ({_HEARTBEAT_GRACE_SECONDS}s grace)")
    # threaded=True so SSE streams don't block other requests on the dev server.
    app.run(host="0.0.0.0", port=port, threaded=True, debug=False)
