"""Export stage: write the per-question deliverable folder.

Each question gets its own folder under <app_folder>/output/<question_id>/.
execute.py has already written result.parquet there (the executed-code output);
this stage rounds out the folder so it is a complete, auditable record:

  result.parquet  — the answer table (present only for code-gen questions)
  code.py         — the exact Polars code that produced it
  answer.md       — the LLM's verbal response
  query.json      — manifest: question, description, attempts, timestamp, paths

For no-code questions (answered from metadata alone) there's no result.parquet
or code.py — just answer.md and the manifest.

Any run with at least one failed attempt — whether it ultimately failed or
recovered on a later try — also gets its failed attempts written under
<app_folder>/output/failed/<question_id>/ by export_failure: one
attempt_N.py per failed attempt (its traceback as a header comment) plus a
manifest (with `resolved` marking whether the run eventually succeeded). The
winning code for a recovered run still lives in the normal <question_id>/ folder.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def export_question(
    question_dir: Path,
    question: str,
    answer: str,
    needs_code: bool,
    code: str | None = None,
    description: str | None = None,
    attempts: int | None = None,
) -> dict[str, Any]:
    """Write the deliverable files into `question_dir`. Returns the manifest."""
    question_dir.mkdir(parents=True, exist_ok=True)
    result_path = question_dir / "result.parquet"

    if code:
        (question_dir / "code.py").write_text(code, encoding="utf-8")
    (question_dir / "answer.md").write_text(answer.strip() + "\n", encoding="utf-8")

    manifest = {
        "question": question,
        "needs_code": needs_code,
        "description": description,
        "attempts": attempts,
        "answered_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "result_parquet": "result.parquet" if result_path.exists() else None,
        "code_file": "code.py" if code else None,
    }
    (question_dir / "query.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8"
    )
    return manifest


def export_failure(
    failed_dir: Path,
    question: str,
    attempts_log: list[dict[str, Any]],
    resolved: bool = False,
) -> dict[str, Any]:
    """Write a run's failed attempts into `failed_dir`: one attempt_N.py per
    failed attempt (the code, with its traceback as a header comment) plus a
    manifest. Called for every run that had at least one failed attempt — whether
    it ultimately failed (`resolved=False`) or recovered on a later attempt
    (`resolved=True`). There's no result.parquet here; the winning code (if any)
    lives in the normal <question_id>/ folder."""
    failed_dir.mkdir(parents=True, exist_ok=True)

    for a in attempts_log:
        code = a.get("code") or ""
        err = (a.get("error") or "").strip()
        header = "# This attempt FAILED with the traceback below.\n"
        header += "\n".join(f"# {line}" for line in err.splitlines())
        body = f"{header}\n\n{code}\n" if code else f"{header}\n"
        (failed_dir / f"attempt_{a['attempt']}.py").write_text(body, encoding="utf-8")

    manifest = {
        "question": question,
        "needs_code": True,
        "resolved": resolved,
        "failed_attempts": len(attempts_log),
        "final_error": attempts_log[-1]["error"] if attempts_log else None,
        "answered_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "attempt_files": [f"attempt_{a['attempt']}.py" for a in attempts_log],
        "errors": {f"attempt_{a['attempt']}": a.get("error") for a in attempts_log},
    }
    (failed_dir / "query.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8"
    )
    return manifest
