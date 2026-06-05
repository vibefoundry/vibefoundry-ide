"""Retry stage: the codegen <-> execute feedback loop.

A code-gen agent validates its output by *running it*, not by inspecting the
reply. So one attempt is: ask the model for code (prompt.run_codegen), clean it
(parse.parse_codegen), run it (execute.execute_code). If parsing or execution
fails, that attempt's code and traceback are recorded and EVERY failure so far —
oldest first — is fed back into the next codegen prompt, so the model can see
what keeps repeating instead of re-deriving the same mistake from a single
sticky-note about only the latest failure.

Repeats up to `max_retries` extra times (from the `codegen` template in
instructions.json). Returns a dict describing the outcome:

  success -> {"ok": True,  "code", "prose", "attempts", "attempts_log"}
  failure -> {"ok": False, "error", "code", "attempts", "attempts_log"}

`attempts_log` is the list of every failed attempt: {attempt, code, error}.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

import execute as execute_mod
import parse as parse_mod
import prompt as prompt_mod

import sys
import time
from contextlib import contextmanager


@contextmanager
def timed(label: str):
    """Same stage-timer helper as in app.py — duplicated here (5 lines) to
    avoid a circular import (app.py imports retry, so retry can't import
    from app)."""
    t0 = time.perf_counter()
    try:
        yield
    finally:
        print(f"[t]   {label}: {time.perf_counter() - t0:.2f}s",
              file=sys.stderr, flush=True)


def get_max_retries() -> int:
    """Extra code-regeneration attempts allowed after the first. 0 disables."""
    return int(prompt_mod.load_template("codegen").get("max_retries", 0))


def _accumulated_feedback(attempts_log: list[dict[str, Any]]) -> str | None:
    """Feedback for the next codegen call: EVERY prior failed attempt, oldest
    first. Seeing the whole sequence (not just the latest) lets the model notice
    what repeats — when the same error recurs, the cause is something common to
    all attempts, so a fresh variation of the same code won't help."""
    if not attempts_log:
        return None

    parts = [
        f"You have already made {len(attempts_log)} failed attempt(s) at this "
        f"question. Every attempt and the error it produced is listed below, "
        f"oldest first. If the same error repeats across attempts, its cause is "
        f"something common to all of them — change THAT; do not resubmit a "
        f"variation of code that already failed the same way."
    ]
    for a in attempts_log:
        code = a.get("code") or "(no code — the codegen request itself failed)"
        parts.append(
            f"\n--- Attempt {a['attempt']} ---\n"
            f"Code you wrote:\n```python\n{code}\n```\n"
            f"Error it raised (complete traceback):\n{a['error']}"
        )
    parts.append(
        "\nReturn corrected code that fixes the specific problem(s) shown above."
    )
    return "\n".join(parts)


def run_codegen_with_retry(
    question: str,
    tables: dict[str, Path],
    result_path: Path,
    history_selection: tuple[list[str], list[str]],
    on_attempt: Callable[[int, dict[str, Any]], None] | None = None,
) -> dict[str, Any]:
    """Generate -> parse -> execute, regenerating on failure.

    `tables` is the {name: path} map of every loaded parquet — threaded into
    the executed code as the TABLES dict the model is expected to reference.

    `history_selection = (relevant_ids, include_code_for)` is the prompt-context
    selection chosen by classify + recency floor — threaded through so every
    codegen attempt sees the same prior turns (and their code).

    `on_attempt(attempt_no, info)` is an optional progress hook called once per
    attempt (info carries the prose/code/error so far)."""
    max_retries = get_max_retries()
    attempts_log: list[dict[str, Any]] = []  # every failed attempt: {attempt, code, error}
    last_code = ""
    last_error = "no attempts made"

    for attempt in range(1, max_retries + 2):
        # Carry ALL prior failures into this attempt, not just the most recent.
        feedback = _accumulated_feedback(attempts_log)

        # 1. ask the model for code
        try:
            with timed(f"codegen_api attempt={attempt}"):
                record = prompt_mod.run_codegen(question, history_selection, feedback=feedback)
        except Exception as e:
            last_error = f"codegen request failed: {e}"
            attempts_log.append({"attempt": attempt, "code": "", "error": last_error})
            if on_attempt:
                on_attempt(attempt, {"error": last_error})
            continue

        # 2. clean + validate the reply
        parsed = parse_mod.parse_codegen(record)
        last_code = parsed["code"] or last_code
        if parsed["error"]:
            last_error = parsed["error"]
            attempts_log.append(
                {"attempt": attempt, "code": parsed["code"], "error": last_error}
            )
            if on_attempt:
                on_attempt(attempt, {"error": last_error, "code": parsed["code"]})
            continue

        # 3. run it in isolation
        if on_attempt:
            on_attempt(attempt, {"code": parsed["code"], "prose": parsed["prose"]})
        with timed(f"execute attempt={attempt}"):
            outcome = execute_mod.execute_code(parsed["code"], tables, result_path)
        if outcome["ok"]:
            return {
                "ok": True,
                "code": parsed["code"],
                "prose": parsed["prose"],
                "attempts": attempt,
                "attempts_log": attempts_log,
            }

        # 4. execution failed — record the EXACT code and FULL traceback. The
        #    next iteration's feedback replays this attempt plus every earlier
        #    one, so the model sees the whole history rather than fixing blind.
        last_error = outcome["error"]
        attempts_log.append(
            {"attempt": attempt, "code": parsed["code"], "error": last_error}
        )

    return {
        "ok": False,
        "error": last_error,
        "code": last_code,
        "attempts": max_retries + 1,
        "attempts_log": attempts_log,
    }
