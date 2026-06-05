"""History stage: conversational memory.

Owns history.json (one row per turn) and, together with the classify stage,
decides which prior turns are sent into the codegen and answer prompts.

  history.json   list[dict]: {question, answer, needs_code, question_id,
                              description, answered_at}
  code           per-turn .py file at <app>/output/<id>/code.py
                 (written by export.export_question); loaded on demand via
                 get_turn_code so history.json itself stays human-readable.

Selection model (no embeddings, no retrieval at request time):

  1. The classify stage sees the FULL history (with each turn's code) and the
     new question, and returns `relevant_history` (turn IDs it judges relevant)
     plus `include_code_for` (turns whose code should ride along to codegen).
  2. resolve_selection(decision, turns) takes classify's picks and adds the
     deterministic RECENCY FLOOR — the last RECENCY_FLOOR turns and their code
     are ALWAYS in the selection, regardless of what classify said. This
     guarantees contentless follow-ups like "yeah, do that" always have the
     immediate context.

The earlier embeddings system (text-embedding-3-small + a sidecar file +
backfill) has been removed; model judgment over the full history is cheaper
in latency and more reliable in practice than cosine over Q+A vectors for the
conversation sizes this chatbot actually sees.
"""

from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_HERE = Path(__file__).resolve().parent
# backend/ -> data_chatbot_codex/ — output/ is a sibling of backend/, keeping the
# app self-contained (no spill into the project-wide output_folder/).
APP_DIR = _HERE.parent
TASK_OUTPUT = APP_DIR / "output"
HISTORY_PATH = TASK_OUTPUT / "history.json"
# Legacy from the prior embeddings system; reset() still cleans it up if present.
_LEGACY_EMBED_PATH = TASK_OUTPUT / "history_embeddings.json"

RECENCY_FLOOR = 3  # last N turns always included in the prompt, with their code.

# The dev server runs threaded=True; serialize writes to history.json.
_write_lock = threading.Lock()


# ---------- persistence ----------

def load() -> list[dict[str, Any]]:
    if not HISTORY_PATH.exists():
        return []
    try:
        return json.loads(HISTORY_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []


def _write_history(turns: list[dict[str, Any]]) -> None:
    TASK_OUTPUT.mkdir(parents=True, exist_ok=True)
    HISTORY_PATH.write_text(json.dumps(turns, indent=2), encoding="utf-8")


def reset() -> None:
    """Clear the conversation."""
    with _write_lock:
        for p in (HISTORY_PATH, _LEGACY_EMBED_PATH):
            if p.exists():
                p.unlink()


def append_turn(
    question: str,
    answer: str,
    needs_code: bool,
    question_id: str,
    description: str | None = None,
) -> None:
    """Append a turn to history.json."""
    with _write_lock:
        turns = load()
        turns.append({
            "question": question,
            "answer": answer,
            "needs_code": needs_code,
            "question_id": question_id,
            "description": description,
            "answered_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        })
        _write_history(turns)


# ---------- code lookup ----------

def get_turn_code(question_id: str | None) -> str | None:
    """Return the Polars code that turn ran, or None for no-code turns or
    missing files. Code is stored per-turn at <task_output>/<id>/code.py by
    export.export_question."""
    if not question_id:
        return None
    path = TASK_OUTPUT / question_id / "code.py"
    if not path.exists():
        return None
    try:
        return path.read_text(encoding="utf-8").strip()
    except OSError:
        return None


# ---------- selection ----------

def resolve_selection(
    decision: dict[str, Any],
    turns: list[dict[str, Any]],
) -> tuple[list[str], list[str]]:
    """Final history selection for prompt assembly: classify's `relevant_history`
    and `include_code_for` picks, UNION the deterministic recency floor (the
    last RECENCY_FLOOR turns and their code, always). Returns
    (relevant_ids, include_code_for_ids)."""
    relevant: set[str] = set(decision.get("relevant_history") or [])
    with_code: set[str] = set(decision.get("include_code_for") or [])
    for t in turns[-RECENCY_FLOOR:]:
        qid = t.get("question_id")
        if qid:
            relevant.add(qid)
            with_code.add(qid)
    # A request for code implicitly marks a turn as relevant.
    relevant |= with_code
    return list(relevant), list(with_code)
