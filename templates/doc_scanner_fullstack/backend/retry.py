"""Step 5 of the pipeline: Retry.

Wraps the OpenAI scan call. A scan can fail two ways — the API call itself
raises (network, rate limit, bad key), or it returns but the JSON is missing a
field the schema requires. Either way we re-ask, up to `max_retries` extra
times. The cap is set per template in instructions.json (`max_retries`).
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any

import prompt as prompt_mod

# Fields every usable receipt record must carry (mirrors output_schema.json).
_REQUIRED_FIELDS = ("location", "date", "state", "city", "items")


def get_max_retries(template: str = "default") -> int:
    """Extra attempts allowed after the first one. 0 disables retries."""
    return int(prompt_mod.load_template(template).get("max_retries", 0))


def _looks_valid(record: Any) -> bool:
    """True when the record is a dict carrying every required field."""
    return isinstance(record, dict) and all(k in record for k in _REQUIRED_FIELDS)


def _is_rate_limit(reason: str) -> bool:
    """True when an error string is an OpenAI 429 / token-per-minute cap."""
    low = reason.lower()
    return "429" in reason or "rate_limit" in low or "rate limit" in low


def _short_reason(reason: str) -> str:
    """Collapse a verbose API error into one readable line — the full 429 JSON
    blob is noise once you know it's a rate limit."""
    if _is_rate_limit(reason):
        return "rate limited (429) — token-per-minute cap hit"
    return reason if len(reason) <= 200 else reason[:197] + "..."


def run_with_retry(
    image_path: Path,
    prompt_text: str,
    model: str | None = None,
    template: str = "default",
    on_retry=None,
    on_fail=None,
) -> dict[str, Any] | None:
    """Scan `image_path` with OpenAI, retrying on failure.

    Returns the parsed receipt record, or None when every attempt failed.
    `on_retry(attempt, reason)` is called before each re-attempt and
    `on_fail(reason)` once when every attempt has been exhausted — both let
    the caller log status (and stay concurrency-safe when many scans run at
    once). If `on_fail` is omitted, the final reason is printed.
    """
    max_retries = get_max_retries(template)
    last_reason = "no attempts made"

    for attempt in range(1, max_retries + 2):
        try:
            record, _raw = prompt_mod.invoke_openai(image_path, prompt_text, model=model)
            if _looks_valid(record):
                return record
            last_reason = f"response missing required fields ({record})"
        except Exception as e:
            last_reason = str(e)

        if attempt <= max_retries:
            if on_retry is not None:
                on_retry(attempt, _short_reason(last_reason))
            # A rate-limit window is a whole minute, so a 1.5s linear backoff
            # just burns the attempt. Wait out a real slice of the window;
            # other transient errors clear fast and keep the short backoff.
            if _is_rate_limit(last_reason):
                time.sleep(20 * attempt)
            else:
                time.sleep(1.5 * attempt)

    reason = f"failed after {max_retries + 1} attempt(s): {_short_reason(last_reason)}"
    if on_fail is not None:
        on_fail(reason)
    else:
        print(f"  scan {reason}")
    return None
