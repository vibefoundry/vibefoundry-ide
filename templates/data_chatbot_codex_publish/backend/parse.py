"""Parse stage: farm the code, prose, and any error out of the LLM reply.

The codegen call returns a JSON object {code, response}. This stage normalizes
it into a clean, runnable form for execute.py:

  * code  — stripped of stray markdown fences the model may have added despite
            the instructions, and validated as non-empty.
  * prose — the one-line description of what the code does.
  * error — set when the reply can't be turned into runnable code (e.g. empty
            code, fenced-but-empty). None when the code looks usable.

Returns a dict {"code": str, "prose": str, "error": str | None}.
"""

from __future__ import annotations

import re
from typing import Any

_FENCE_RE = re.compile(r"^\s*```(?:python|py)?\s*\n?(.*?)\n?```\s*$", re.DOTALL)


def _strip_fences(code: str) -> str:
    """Remove a surrounding ```python ... ``` fence if the model added one."""
    m = _FENCE_RE.match(code.strip())
    return m.group(1).strip() if m else code.strip()


def parse_codegen(record: dict[str, Any]) -> dict[str, Any]:
    """Normalize a {code, response} codegen reply into {code, prose, error}."""
    raw_code = record.get("code")
    prose = (record.get("response") or "").strip()

    if not isinstance(raw_code, str):
        return {"code": "", "prose": prose, "error": "model reply had no 'code' string"}

    code = _strip_fences(raw_code)

    if not code:
        return {"code": "", "prose": prose, "error": "model returned empty code"}

    # The code must write its result where execute.py expects to find it.
    if "RESULT_PATH" not in code:
        return {
            "code": code,
            "prose": prose,
            "error": "code never writes to RESULT_PATH — nothing would be produced",
        }

    return {"code": code, "prose": prose, "error": None}
