"""Steps 2-4 of the pipeline: Build Prompt, Send To OpenAI, OpenAI Scans Image.

`build_prompt` assembles the instruction text (system prompt + per-field rules +
the allowed category list). `invoke_openai` base64-encodes a receipt image and
sends it, alongside the prompt, to the OpenAI vision API — asking for a JSON
object that matches output_schema.json.
"""

from __future__ import annotations

import base64
import json
import mimetypes
from pathlib import Path
from typing import Any

_HERE = Path(__file__).parent
INSTRUCTIONS_PATH = _HERE / "instructions.json"
SCHEMA_PATH = _HERE / "output_schema.json"
# The app folder (this file's own directory, same level as run_app.sh) holds
# the .env file with OPENAI_API_KEY.
APP_DIR = _HERE.resolve()

# OpenAI rejects images larger than 20 MB. iPhone receipt photos routinely
# exceed that, so if Pillow is installed we downscale before encoding.
_MAX_IMAGE_DIM = 2000


def _load_dotenv() -> None:
    """Load KEY=VALUE pairs from the app-folder .env into os.environ.

    Hand-rolled so the scanner needs no python-dotenv dependency. Values
    already present in the real environment win — .env never overrides them.
    """
    import os

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


def _load_instructions_file() -> dict[str, Any]:
    with INSTRUCTIONS_PATH.open() as f:
        return json.load(f)


def load_template(name: str = "default") -> dict[str, Any]:
    """Return one entry from `instructions.<name>` in instructions.json."""
    templates = _load_instructions_file().get("instructions", {})
    if name not in templates:
        raise KeyError(f"instruction template {name!r} not found in {INSTRUCTIONS_PATH}")
    return templates[name]


def load_schema() -> dict[str, Any]:
    """Return the JSON schema OpenAI must match (output_schema.json)."""
    with SCHEMA_PATH.open() as f:
        return json.load(f)


def get_model(template: str = "default") -> str:
    """Which OpenAI vision model to call (set in instructions.json)."""
    return load_template(template).get("model", "gpt-4o-mini")


# ---------- step 2: build prompt ----------

def build_prompt(template: str = "default") -> str:
    """Assemble the text instruction sent alongside the receipt image. The
    category list is pulled straight from the schema's `category` enum so the
    prompt and the schema can never drift apart."""
    tpl = load_template(template)
    rules = "\n".join(f"- {r}" for r in tpl["rules"])

    schema = load_schema()
    categories = schema.get("properties", {}).get("category", {}).get("enum", [])
    category_block = "\n".join(f"- {c}" for c in categories) or "(none defined)"

    return (
        f"{tpl['system']}\n\n"
        f"=== FIELD RULES ===\n{rules}\n\n"
        f"=== ALLOWED CATEGORIES (pick exactly one) ===\n{category_block}\n\n"
        f"Scan the attached receipt image and respond ONLY with a JSON object "
        f"matching the supplied schema. No prose, no markdown fences."
    )


# ---------- step 3: send to OpenAI ----------

def _encode_image(image_path: Path) -> tuple[str, str]:
    """Return (base64_data, mime_type) for the image. Downscales oversized
    photos with Pillow when it is available; otherwise sends the file as-is."""
    mime, _ = mimetypes.guess_type(image_path.name)
    if mime is None or not mime.startswith("image/"):
        mime = "image/png"

    try:
        from io import BytesIO

        from PIL import Image  # type: ignore

        with Image.open(image_path) as im:
            if max(im.size) > _MAX_IMAGE_DIM:
                im.thumbnail((_MAX_IMAGE_DIM, _MAX_IMAGE_DIM))
            fmt = "PNG" if mime == "image/png" else "JPEG"
            buf = BytesIO()
            im.convert("RGB").save(buf, format=fmt)
            return base64.b64encode(buf.getvalue()).decode(), f"image/{fmt.lower()}"
    except Exception:
        # Pillow missing or failed — fall back to the raw bytes.
        return base64.b64encode(image_path.read_bytes()).decode(), mime


# ---------- step 4: OpenAI scans the image ----------

def invoke_openai(
    image_path: Path,
    prompt_text: str,
    model: str | None = None,
    timeout: int = 120,
) -> tuple[dict[str, Any], str]:
    """Send the receipt image + prompt to the OpenAI vision API.

    Returns (parsed_record, raw_json_text). Raises RuntimeError when the SDK
    is missing / unconfigured and on any API failure.
    """
    try:
        from openai import OpenAI  # type: ignore
    except ImportError as e:
        raise RuntimeError(
            "openai SDK not installed. Install it with: pip install openai"
        ) from e

    import os

    if not os.environ.get("OPENAI_API_KEY"):
        raise RuntimeError(
            "OPENAI_API_KEY is not set. Export your key before running the scanner."
        )

    # max_retries lets the SDK ride out 429s on its own: it honors the
    # Retry-After / rate-limit-reset headers and backs off exponentially, so a
    # token-per-minute cap is waited out rather than failed on.
    client = OpenAI(max_retries=8)
    b64, mime = _encode_image(image_path)
    schema = load_schema()

    response = client.chat.completions.create(
        model=model or get_model(),
        timeout=timeout,
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt_text},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{mime};base64,{b64}"},
                    },
                ],
            }
        ],
        response_format={
            "type": "json_schema",
            "json_schema": {
                "name": "receipt_extraction",
                "strict": True,
                "schema": schema,
            },
        },
    )

    raw = response.choices[0].message.content or ""
    return _parse_response(raw), raw


def _parse_response(raw: str) -> dict[str, Any]:
    """Parse the model's JSON reply. With json_schema response format the
    content is already clean JSON, but we stay defensive about stray fences."""
    s = raw.strip()
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        pass
    import re

    m = re.search(r"\{.*\}", s, re.DOTALL)
    if not m:
        raise ValueError(f"could not extract JSON from OpenAI output:\n{s[:500]}")
    return json.loads(m.group(0))
