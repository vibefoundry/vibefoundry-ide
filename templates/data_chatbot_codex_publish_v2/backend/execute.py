"""Execute stage: run the model-generated code against the dataset.

Executing model-written code is the security-sensitive stage, so it runs in an
isolated subprocess — never in the backend process:

  * a fresh `python` interpreter, not this one;
  * a scrubbed environment with the API keys removed, so generated code can't
    read OPENAI_API_KEY (or any *_API_KEY / *_SECRET) and exfiltrate it;
  * a wall-clock timeout so a runaway query can't hang the server;
  * stdout/stderr captured, so a traceback comes back as a string that retry.py
    can feed to the model for a fix.

The generated code runs with three names predefined: `pl` (polars), `TABLES`
(a dict mapping each loaded table's name to its parquet path — e.g.
`pl.scan_parquet(TABLES["OutletAttributes"])`), and `RESULT_PATH` (where it
must write its answer). On success RESULT_PATH holds the answer parquet;
`result_preview` renders it for the final answer prompt.
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

import polars as pl

_RUNNER_PREAMBLE = """\
import polars as pl
TABLES = {tables_dict!r}
RESULT_PATH = {result_path!r}

# ---- model-generated code below ----
"""

_TIMEOUT_SECONDS = 180


def _scrubbed_env() -> dict[str, str]:
    """Copy the environment but drop anything that looks like a secret."""
    env = dict(os.environ)
    for key in list(env):
        upper = key.upper()
        if "API_KEY" in upper or "SECRET" in upper or "TOKEN" in upper:
            env.pop(key, None)
    return env


def execute_code(code: str, tables: dict[str, Path], result_path: Path) -> dict[str, Any]:
    """Run `code` in an isolated subprocess. `tables` is the {name: path} map
    that gets serialized into the runner as a TABLES dict the model code
    references. Returns {"ok": bool, "error": str | None, "stderr": str}."""
    result_path.parent.mkdir(parents=True, exist_ok=True)
    # Stale result from a prior attempt must not be mistaken for success.
    if result_path.exists():
        result_path.unlink()

    # repr() of a dict-of-str-to-str produces a valid Python literal.
    tables_dict = {name: str(p) for name, p in tables.items()}
    script = _RUNNER_PREAMBLE.format(
        tables_dict=tables_dict, result_path=str(result_path)
    ) + code

    with tempfile.TemporaryDirectory() as tmp:
        runner = Path(tmp) / "run_generated.py"
        runner.write_text(script, encoding="utf-8")
        try:
            proc = subprocess.run(
                [sys.executable, str(runner)],
                cwd=tmp,
                env=_scrubbed_env(),
                capture_output=True,
                text=True,
                timeout=_TIMEOUT_SECONDS,
            )
        except subprocess.TimeoutExpired:
            return {
                "ok": False,
                "error": f"code timed out after {_TIMEOUT_SECONDS}s",
                "stderr": "",
            }

    if proc.returncode != 0:
        # Return the FULL traceback — no truncation. The retry step needs the
        # whole error to fix the code.
        err = proc.stderr.strip()
        return {"ok": False, "error": err or "code exited non-zero (no stderr)", "stderr": proc.stderr}

    if not result_path.exists():
        return {
            "ok": False,
            "error": "code ran without error but did not write RESULT_PATH",
            "stderr": proc.stderr,
        }

    return {"ok": True, "error": None, "stderr": proc.stderr}


def result_preview(result_path: Path, max_rows: int = 50) -> str:
    """Render the executed result parquet as text (columns + rows + total count)
    for the final answer prompt. Reads only the preview rows, not the whole file."""
    total = pl.scan_parquet(result_path).select(pl.len()).collect(engine="streaming").item()
    head = pl.read_parquet(result_path).head(max_rows)

    lines = [f"{total:,} result row(s), {head.width} column(s)."]
    if total > max_rows:
        lines.append(f"(showing first {max_rows})")
    with pl.Config(
        tbl_rows=max_rows,
        tbl_cols=-1,
        tbl_width_chars=200,
        fmt_str_lengths=80,
    ):
        lines.append(str(head))
    return "\n".join(lines)
