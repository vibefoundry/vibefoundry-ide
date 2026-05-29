"""Prompt stage: build the prompts and call OpenAI.

This module owns every model call the chatbot makes and never lets the dataset
itself reach the model — only metadata.json (the column/value profile), the
selected conversation history (with optional per-turn code), and the user's
question. Three prompts live here:

  * classify — given metadata + the FULL conversation history (with each
               turn's code) + question, return a JSON routing decision:
               {needs_code, relevant_history, include_code_for}. Never writes
               prose; the answer stage handles that for every code path so the
               user always sees a streamed reply.
  * codegen  — given metadata + selected history + question, ask for
               {code, response} (JSON constrained by output_schema.json). The
               code, once run by execute.py, produces the answer table.
  * answer   — given the executed result preview (or, for no-code questions,
               just a placeholder) + selected history + question, ask for the
               final verbal reply in plain prose, streamed token-by-token.

classify decides which prior turn IDs are relevant; the rest of this module
honors that selection plus the recency floor enforced by
history.resolve_selection.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import history as history_mod
import metadata as metadata_mod

_HERE = Path(__file__).resolve().parent
INSTRUCTIONS_PATH = _HERE / "instructions.json"
SCHEMA_PATH = _HERE / "output_schema.json"
# backend/ -> data_chatbot/  (the app folder, holds .env next to run_app.sh)
APP_DIR = _HERE.parent

# Selection passed through from classify + history.resolve_selection.
# (relevant_ids, include_code_for_ids)
HistorySelection = tuple[list[str], list[str]]


def _load_dotenv() -> None:
    """Load KEY=VALUE pairs from the app-folder .env into os.environ.

    Hand-rolled so there's no python-dotenv dependency. Real environment
    values always win — .env never overrides an already-set variable.
    """
    env_path = APP_DIR / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


_load_dotenv()


# ---------- config loading ----------

def _load_instructions_file() -> dict[str, Any]:
    with INSTRUCTIONS_PATH.open() as f:
        return json.load(f)


def load_template(name: str) -> dict[str, Any]:
    """Return one entry from `instructions.<name>` in instructions.json."""
    templates = _load_instructions_file().get("instructions", {})
    if name not in templates:
        raise KeyError(f"instruction template {name!r} not found in {INSTRUCTIONS_PATH}")
    return templates[name]


def load_schema() -> dict[str, Any]:
    """The codegen reply schema ({code, response}) from output_schema.json."""
    with SCHEMA_PATH.open() as f:
        return json.load(f)


def get_model(template: str) -> str:
    return load_template(template).get("model", "gpt-5-mini")


# ---------- shared OpenAI calls ----------

def _client():
    try:
        from openai import OpenAI  # type: ignore
    except ImportError as e:
        raise RuntimeError(
            "openai SDK not installed. Install it with: pip install openai"
        ) from e
    if not os.environ.get("OPENAI_API_KEY"):
        raise RuntimeError(
            "OPENAI_API_KEY is not set. Create a .env at the top of this app "
            "folder (next to run_app.sh) containing: OPENAI_API_KEY=sk-..."
        )
    # max_retries lets the SDK ride out 429s on its own (honors Retry-After).
    return OpenAI(max_retries=6)


def call_json(
    template: str,
    user_text: str,
    schema: dict[str, Any],
    schema_name: str,
    timeout: int = 120,
) -> dict[str, Any]:
    """Call the model with a strict json_schema response format and return the
    parsed object. The template supplies the system prompt and model id."""
    tpl = load_template(template)
    client = _client()
    response = client.chat.completions.create(
        model=tpl.get("model") or get_model(template),
        timeout=timeout,
        messages=[
            {"role": "system", "content": tpl["system"]},
            {"role": "user", "content": user_text},
        ],
        response_format={
            "type": "json_schema",
            "json_schema": {"name": schema_name, "strict": True, "schema": schema},
        },
    )
    return _parse_json(response.choices[0].message.content or "")


def call_text(template: str, user_text: str, timeout: int = 120) -> str:
    """Plain-text completion (no schema). Used for the final verbal answer."""
    tpl = load_template(template)
    client = _client()
    response = client.chat.completions.create(
        model=tpl.get("model") or get_model(template),
        timeout=timeout,
        messages=[
            {"role": "system", "content": tpl["system"]},
            {"role": "user", "content": user_text},
        ],
    )
    return (response.choices[0].message.content or "").strip()


def call_text_stream(template: str, user_text: str, timeout: int = 120):
    """Streaming plain-text completion — yields content tokens as they arrive."""
    tpl = load_template(template)
    client = _client()
    stream = client.chat.completions.create(
        model=tpl.get("model") or get_model(template),
        timeout=timeout,
        stream=True,
        messages=[
            {"role": "system", "content": tpl["system"]},
            {"role": "user", "content": user_text},
        ],
    )
    for chunk in stream:
        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta


def _parse_json(raw: str) -> dict[str, Any]:
    """Parse a JSON reply. With json_schema response format the content is
    already clean, but stay defensive about stray fences."""
    import re

    s = raw.strip()
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        pass
    m = re.search(r"\{.*\}", s, re.DOTALL)
    if not m:
        raise ValueError(f"could not extract JSON from model output:\n{s[:500]}")
    return json.loads(m.group(0))


# ---------- prompt assembly ----------

def metadata_block() -> str:
    """The compact dataset profile injected into every prompt."""
    return metadata_mod.metadata_for_prompt()


def _history_block(history_selection: HistorySelection) -> str:
    """Conversation context for the codegen / answer prompts: format the prior
    turns whose IDs are in `relevant_ids`, attaching code only for those whose
    IDs are in `include_code_for`. Turns are emitted in chronological order
    (iteration order of history.json)."""
    relevant_ids, include_code_for = history_selection
    relevant = set(relevant_ids or [])
    with_code = set(include_code_for or [])
    if not relevant:
        return "(no previous turns)"
    lines: list[str] = []
    for t in history_mod.load():
        qid = t.get("question_id")
        if qid not in relevant:
            continue
        q = (t.get("question") or "").strip()
        a = (t.get("answer") or "").strip()
        if q:
            lines.append(f"User: {q}")
        if a:
            lines.append(f"Assistant: {a}")
        if qid in with_code:
            code = history_mod.get_turn_code(qid)
            if code:
                lines.append(f"Code:\n```python\n{code}\n```")
    return "\n".join(lines) or "(no previous turns)"


def full_history_with_code_block() -> str:
    """The classify prompt's history block: EVERY prior turn with its
    question_id prominently labeled, plus any code that turn ran. Lets the
    classifier pick `relevant_history` and `include_code_for` by ID."""
    turns = history_mod.load()
    if not turns:
        return "(no previous turns)"
    blocks: list[str] = []
    for t in turns:
        qid = t.get("question_id") or "<unknown>"
        q = (t.get("question") or "").strip()
        a = (t.get("answer") or "").strip()
        code = history_mod.get_turn_code(qid) if t.get("needs_code") else None
        parts = [f"--- Turn id={qid} ---"]
        if q:
            parts.append(f"User: {q}")
        if a:
            parts.append(f"Assistant: {a}")
        if code:
            parts.append(f"Code:\n```python\n{code}\n```")
        blocks.append("\n".join(parts))
    return "\n\n".join(blocks)


def _rules_block(template: str) -> str:
    return "\n".join(f"- {r}" for r in load_template(template).get("rules", []))


# Strict json_schema for the classify call: every property required,
# additionalProperties false. Mirrors what classify.py used to own.
_CLASSIFY_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["needs_code", "relevant_history", "include_code_for"],
    "properties": {
        "needs_code": {
            "type": "boolean",
            "description": "True if answering requires running code over the rows; False if the metadata profile already contains the answer.",
        },
        "relevant_history": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Question IDs of prior turns whose Q&A is directly relevant context for THIS question (the user is following up on them, referring to their results, asking a variation, etc.). Empty array if none. The last 3 turns are ALWAYS attached downstream — do not redundantly list them here.",
        },
        "include_code_for": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Subset of question IDs whose generated Polars code should be attached to the codegen prompt as a pattern to adapt (e.g., this question is the same shape as that turn but for a different state or brand). Empty array if none. The last 3 turns' code is ALWAYS attached downstream — do not redundantly list them here.",
        },
    },
}


def build_classify_prompt(question: str) -> str:
    """User-message text for the classify call: metadata + the FULL conversation
    history (with each prior turn's code attached) + the rules + the question.
    Classify picks `relevant_history` and `include_code_for` by ID, so it needs
    every turn's id labeled and every turn's code in front of it."""
    return (
        f"=== DATASET METADATA ===\n{metadata_block()}\n\n"
        f"=== FULL CONVERSATION HISTORY (with code per turn) ===\n"
        f"{full_history_with_code_block()}\n\n"
        f"=== RULES ===\n{_rules_block('classify')}\n\n"
        f"=== USER QUESTION ===\n{question}\n\n"
        f"Decide route + pick relevant history + pick which turns' code to "
        f"attach, as the JSON object the schema requires."
    )


def build_codegen_prompt(question: str, history_selection: HistorySelection) -> str:
    """User-message text for the codegen call."""
    return (
        f"=== DATASET METADATA ===\n{metadata_block()}\n\n"
        f"=== CONVERSATION SO FAR ===\n{_history_block(history_selection)}\n\n"
        f"=== RULES ===\n{_rules_block('codegen')}\n\n"
        f"=== USER QUESTION ===\n{question}\n\n"
        f"Write the Polars code that answers this question and the one-line "
        f"description, as the JSON object the schema requires."
    )


def build_answer_prompt(
    question: str,
    result_preview: str | None,
    history_selection: HistorySelection,
) -> str:
    """User-message text for the final verbal answer call. `result_preview` is
    the rendered preview of the executed result table on the code path; pass
    None for no-code questions so the COMPUTED RESULT section is omitted
    entirely (rather than stuffing in a placeholder the model dutifully quotes
    back as 'I have no preview numbers to cite')."""
    sections = [
        f"=== DATASET METADATA ===\n{metadata_block()}",
        f"=== CONVERSATION SO FAR ===\n{_history_block(history_selection)}",
        f"=== USER QUESTION ===\n{question}",
    ]
    if result_preview:
        sections.append(f"=== COMPUTED RESULT (preview) ===\n{result_preview}")
    sections.append(f"=== STYLE RULES ===\n{_rules_block('answer')}")
    sections.append("Write the answer now.")
    return "\n\n".join(sections)


# ---------- high-level entry points ----------

def run_classify(question: str) -> dict[str, Any]:
    """Route the question + pick history context. Returns
    {needs_code, relevant_history, include_code_for}. Never writes prose — the
    answer stage handles that for every path, so the user always sees a
    streamed reply rather than a blob from a JSON-schema-constrained call."""
    result = call_json(
        "classify",
        build_classify_prompt(question),
        _CLASSIFY_SCHEMA,
        "route_decision",
    )
    return {
        "needs_code": bool(result.get("needs_code", True)),
        "relevant_history": list(result.get("relevant_history") or []),
        "include_code_for": list(result.get("include_code_for") or []),
    }


def run_codegen(
    question: str,
    history_selection: HistorySelection,
    feedback: str | None = None,
) -> dict[str, Any]:
    """Ask the model for {code, response}. `feedback` carries every prior
    failed attempt (oldest first) back into the prompt so the model sees what
    keeps repeating instead of re-deriving the same mistake."""
    user_text = build_codegen_prompt(question, history_selection)
    if feedback:
        user_text += (
            f"\n\n=== PREVIOUS ATTEMPT FAILED ===\nThe code you wrote raised an "
            f"error when run. Fix it and try again.\n{feedback}"
        )
    return call_json("codegen", user_text, load_schema(), "data_query")


def run_answer(
    question: str,
    result_preview: str | None,
    history_selection: HistorySelection,
) -> str:
    """Final verbal answer. `result_preview` is the executed result table on
    the code path; pass None on the no-code path so the prompt omits the
    section entirely."""
    return call_text("answer", build_answer_prompt(question, result_preview, history_selection))


def run_answer_stream(
    question: str,
    result_preview: str | None,
    history_selection: HistorySelection,
):
    """Streaming final verbal answer — yields tokens as they arrive. Pass
    `result_preview=None` for no-code questions."""
    yield from call_text_stream(
        "answer", build_answer_prompt(question, result_preview, history_selection)
    )
