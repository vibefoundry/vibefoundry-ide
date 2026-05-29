"""Prompt stage: build the prompts and call Codex CLI.

Every model call in this chatbot is a one-shot `codex exec` subprocess. The
dataset itself never reaches the model — only metadata.json (the column/value
profile), the selected conversation history (with optional per-turn code), and
the user's question.

The three calls map to codex like this:

  * classify — given metadata + the FULL conversation history (with each turn's
               code) + question, return a JSON routing decision:
               {needs_code, relevant_history, include_code_for}.
               Schema-enforced via --output-schema classify_schema.json.
  * codegen  — given metadata + selected history + question, ask for
               {code, response}. Schema-enforced via --output-schema
               output_schema.json. The code, once run by execute.py,
               produces the answer table.
  * answer   — given the executed result preview (or None, for no-code
               questions) + selected history + question, ask for the final
               verbal reply in plain prose. No schema; codex returns the
               whole reply in one shot (no streaming).

Sandbox / isolation:
  Every call runs with `-C <empty-tmp-dir>` (codex sees no project files even
  if it tries to glob/grep) and `-s read-only` (model-issued shell commands
  cannot write). The prompt itself also tells the model that all needed
  context is inline.

Authentication:
  Codex CLI manages its own credentials via `codex login`. There is no
  OPENAI_API_KEY check here — if codex isn't installed or isn't logged in,
  the subprocess fails and CodexCallError surfaces to the caller.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import history as history_mod
import metadata as metadata_mod

_HERE = Path(__file__).resolve().parent
INSTRUCTIONS_PATH = _HERE / "instructions.json"
SCHEMA_PATH = _HERE / "output_schema.json"
CLASSIFY_SCHEMA_PATH = _HERE / "classify_schema.json"
# backend/ -> data_chatbot_codex/  (the app folder, sibling to run_app.sh).
APP_DIR = _HERE.parent

# Selection passed through from classify + history.resolve_selection.
# (relevant_ids, include_code_for_ids)
HistorySelection = tuple[list[str], list[str]]


def _load_dotenv() -> None:
    """Load KEY=VALUE pairs from the app-folder .env into os.environ.

    Codex itself authenticates via `codex login`, not env vars — but the .env
    loader stays so the user can still ship secondary vars (e.g. a model
    override, proxy settings) in .env if their flow needs them. Real env
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


# ---------- codex subprocess ----------

CODEX_BIN = "codex"
# Generous default — codex can reason for a while on a tricky codegen prompt.
# retry.py wraps codegen, so a stuck call still gets retried up to max_retries.
CODEX_TIMEOUT = 600


class CodexCallError(RuntimeError):
    """A `codex exec` call failed (binary missing, timeout, non-zero exit,
    missing output file, malformed JSON). The codegen path in retry.py catches
    this and feeds it back as a failed attempt; classify and answer surface it
    to the SSE error event."""


class CodexAuthError(CodexCallError):
    """Codex's session is expired or otherwise unauthenticated. Distinguished
    from generic CodexCallError so app.py can emit a specific SSE error code
    that the frontend matches to open the re-auth modal. Subclass of
    CodexCallError so retry.py keeps catching it as a normal failed attempt
    (re-auth-then-retry happens at the UI layer, not the retry-loop layer)."""


# Substrings codex emits when its OAuth token is invalid. We match against
# whichever stream the failing process wrote to (stderr or stdout) — codex
# changes that across versions, so check both.
_AUTH_FAILURE_HINTS = ("401", "unauthorized", "token_invalidated", "auth error")


def _looks_like_auth_failure(text: str) -> bool:
    low = text.lower()
    return any(hint in low for hint in _AUTH_FAILURE_HINTS)


def _check_codex() -> None:
    """Used by the /api/auth/codex/login endpoint and setup checks. For actual
    subprocess invocations, _run_codex resolves the full path itself."""
    if not shutil.which(CODEX_BIN):
        raise CodexCallError(
            f"`{CODEX_BIN}` not found on PATH. Install OpenAI Codex CLI and "
            f"run `{CODEX_BIN} login` before launching this chatbot."
        )


def _compose_prompt(system: str, user_text: str) -> str:
    """Codex CLI has no separate `system` role — there's just the prompt the
    model sees. Fold the template's system instructions in as a labeled
    header so the model can still distinguish them from the task body."""
    sandbox_note = (
        "You are a model assistant invoked from a Python subprocess. ALL "
        "context you need is inline in this prompt — do not call any file, "
        "grep, list, or shell tools to look for more. Reply with the requested "
        "answer only."
    )
    return (
        f"=== SYSTEM INSTRUCTIONS ===\n{system}\n\n"
        f"=== EXECUTION CONTEXT ===\n{sandbox_note}\n\n"
        f"=== TASK ===\n{user_text}"
    )


def _run_codex(
    prompt_text: str,
    schema_path: Path | None,
    *,
    timeout: int = CODEX_TIMEOUT,
) -> str:
    """Run `codex exec` non-interactively with prompt piped via stdin.

    Returns the model's final message as a string — JSON text if `schema_path`
    was given (the caller then parses it), plain text otherwise.

    Sandbox layers (in order of how reliable each is on its own):
      1. `-C <empty tmpdir>`: codex's working directory has nothing to read.
      2. `-s read-only`: codex's shell sandbox denies any write attempt.
      3. Prompt-level instruction: 'don't use tools, just answer' (in
         _compose_prompt). Cheap, helps the model behave even before the
         sandbox kicks in.

    Raises CodexCallError on:
      * codex missing from PATH
      * subprocess timeout
      * non-zero exit code
      * empty / missing output file
    """
    # Resolve the full absolute path once here. Passing the bare name "codex"
    # to subprocess.run forces a PATH lookup at spawn time inside the child
    # process environment — on Windows that environment can differ from the
    # shell that started Flask (e.g. PATH set by an installer after the
    # terminal opened, or concurrently running with a trimmed env). Using the
    # absolute path skips the lookup entirely.
    codex_path = shutil.which(CODEX_BIN)
    if not codex_path:
        raise CodexCallError(
            f"`{CODEX_BIN}` not found on PATH. Install OpenAI Codex CLI and "
            f"run `{CODEX_BIN} login` before launching this chatbot."
        )

    with tempfile.TemporaryDirectory(prefix="codex_call_") as tmp:
        sandbox = Path(tmp) / "sandbox"
        sandbox.mkdir()
        out_file = Path(tmp) / "out.txt"

        cmd = [
            codex_path, "exec",
            "-C", str(sandbox),
            "-s", "read-only",
            "-o", str(out_file),
            # The empty sandbox dir is deliberately NOT a git repo — that's the
            # whole isolation point. Without this flag codex refuses to run
            # outside a "trusted" git directory.
            "--skip-git-repo-check",
            # No positional prompt — read from stdin so we don't hit argv
            # length limits on big prompts and don't have to shell-escape.
        ]
        if schema_path is not None:
            cmd.extend(["--output-schema", str(schema_path)])

        try:
            proc = subprocess.run(
                cmd,
                input=prompt_text,
                capture_output=True,
                text=True,
                encoding="utf-8",  # explicit UTF-8 — Windows defaults to cp1252
                timeout=timeout,
                check=False,
            )
        except FileNotFoundError as e:
            # Race: PATH lookup passed but codex was uninstalled mid-call.
            raise CodexCallError(f"codex disappeared from PATH: {e}") from e
        except subprocess.TimeoutExpired as e:
            raise CodexCallError(f"codex timed out after {timeout}s") from e

        if proc.returncode != 0:
            combined = (proc.stderr or "") + "\n" + (proc.stdout or "")
            stderr_snip = combined.strip()[:500]
            if _looks_like_auth_failure(combined):
                raise CodexAuthError(
                    "Codex authentication failed (token expired or invalidated). "
                    "Run `codex logout && codex login` and try again."
                )
            raise CodexCallError(
                f"codex exited with code {proc.returncode}: {stderr_snip}"
            )

        if not out_file.exists():
            # Some failure paths exit 0 but never write `-o`; treat as error.
            stderr_snip = (proc.stderr or "").strip()[:500]
            raise CodexCallError(
                f"codex produced no output file. stderr: {stderr_snip}"
            )

        text = out_file.read_text().strip()
        if not text:
            raise CodexCallError("codex output file was empty")
        return text


def call_json(
    template: str,
    user_text: str,
    schema_path: Path,
    timeout: int = CODEX_TIMEOUT,
) -> dict[str, Any]:
    """Call codex with the given template's system prompt and a JSON Schema
    constraint, then return the parsed object.

    Raises CodexCallError on subprocess failure OR on a malformed reply that
    json.loads can't read. The codegen path's retry loop turns CodexCallError
    into another attempt with the failure fed back into the next prompt.
    """
    tpl = load_template(template)
    full_prompt = _compose_prompt(tpl["system"], user_text)
    raw = _run_codex(full_prompt, schema_path, timeout=timeout)
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        raise CodexCallError(
            f"codex returned non-JSON despite --output-schema: {raw[:500]}"
        ) from e


def call_text(template: str, user_text: str, timeout: int = CODEX_TIMEOUT) -> str:
    """Free-text completion (no schema). Used for the final verbal answer."""
    tpl = load_template(template)
    full_prompt = _compose_prompt(tpl["system"], user_text)
    return _run_codex(full_prompt, schema_path=None, timeout=timeout)


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


def build_classify_prompt(question: str) -> str:
    """User-message text for the classify call: metadata + the FULL conversation
    history (with each prior turn's code attached) + the rules + the question."""
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
    {needs_code, relevant_history, include_code_for}."""
    result = call_json(
        "classify",
        build_classify_prompt(question),
        CLASSIFY_SCHEMA_PATH,
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
    return call_json("codegen", user_text, SCHEMA_PATH)


def run_answer(
    question: str,
    result_preview: str | None,
    history_selection: HistorySelection,
) -> str:
    """Final verbal answer. Blocking — codex returns the whole reply at once."""
    return call_text(
        "answer", build_answer_prompt(question, result_preview, history_selection)
    )


def run_answer_stream(
    question: str,
    result_preview: str | None,
    history_selection: HistorySelection,
):
    """Generator wrapper so app.py's existing SSE plumbing keeps working
    unchanged. Codex returns the whole answer after the subprocess exits —
    there is no token-by-token stream — so this just yields the full reply
    as a single chunk. The frontend sees one big answer_delta event
    followed by the answer event."""
    yield run_answer(question, result_preview, history_selection)
