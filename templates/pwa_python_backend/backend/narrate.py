"""Final stage: Narrate.

Reads classifications.csv + line_items.csv, builds a small digest (totals,
top stores, category breakdown, biggest items), sends the digest to the model,
and writes a prose spending summary to output_folder/image_scanner/summary.md.

Plain text completion — no json_schema. Per the agentic-framework recipe,
narration relies on the OpenAI SDK's built-in max_retries for network
resilience rather than a field-validation retry loop.
"""

from __future__ import annotations

from pathlib import Path

import polars as pl

import prompt as prompt_mod


# Cap how much we ship to the model — the digest must stay small.
_TOP_STORES = 5
_TOP_ITEMS = 5


def _build_digest(classifications_csv: Path, line_items_csv: Path) -> str | None:
    """Aggregate the two CSVs into a compact text digest. Returns None when
    there's nothing to summarize (no receipts scanned yet)."""
    if not classifications_csv.exists() or not line_items_csv.exists():
        return None

    # Lazy + column-pruned per the Polars rules. The CSVs are tiny, but follow
    # the convention so the pattern stays consistent across the project.
    receipts = (
        pl.scan_csv(classifications_csv)
          .select(["receipt_id", "location", "date"])
    )
    items = (
        pl.scan_csv(line_items_csv)
          .select(["receipt_id", "item", "price", "item_type"])
          .filter(pl.col("price").is_not_null())
    )

    items_df = items.collect(engine="streaming")
    if items_df.is_empty():
        return None

    receipts_df = receipts.collect(engine="streaming")

    total_spent = float(items_df["price"].sum())
    receipt_count = receipts_df.height
    item_count = items_df.height

    dates = [d for d in receipts_df["date"].to_list() if d]
    date_range = f"{min(dates)} to {max(dates)}" if dates else "unknown date range"

    by_type = (
        items_df.group_by("item_type")
                .agg(pl.col("price").sum().alias("spend"),
                     pl.len().alias("count"))
                .sort("spend", descending=True)
    )

    # Join items to receipts to get spend per store (location).
    joined = items_df.join(receipts_df, on="receipt_id", how="left")
    by_store = (
        joined.group_by("location")
              .agg(pl.col("price").sum().alias("spend"),
                   pl.col("receipt_id").n_unique().alias("visits"))
              .sort("spend", descending=True)
              .head(_TOP_STORES)
    )

    top_items = (
        joined.select(["item", "price", "location", "item_type"])
              .sort("price", descending=True)
              .head(_TOP_ITEMS)
    )

    lines: list[str] = []
    lines.append(f"Total spent: ${total_spent:,.2f}")
    lines.append(f"Receipts: {receipt_count}")
    lines.append(f"Line items: {item_count}")
    lines.append(f"Date range: {date_range}")

    lines.append("")
    lines.append("Spend by category:")
    for row in by_type.iter_rows(named=True):
        lines.append(
            f"  - {row['item_type']}: ${row['spend']:,.2f} ({row['count']} items)"
        )

    lines.append("")
    lines.append(f"Top {by_store.height} stores by spend:")
    for row in by_store.iter_rows(named=True):
        loc = row["location"] or "Unknown"
        lines.append(
            f"  - {loc}: ${row['spend']:,.2f} across {row['visits']} visit(s)"
        )

    lines.append("")
    lines.append(f"Top {top_items.height} biggest line items:")
    for row in top_items.iter_rows(named=True):
        loc = row["location"] or "Unknown"
        lines.append(
            f"  - {row['item']} (${row['price']:,.2f}) at {loc} [{row['item_type']}]"
        )

    return "\n".join(lines)


def _call_model(digest: str, template: str = "narrate") -> str:
    """Send the digest to the model and return the prose reply. Plain text
    completion — no json_schema response format."""
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

    tpl = prompt_mod.load_template(template)
    system = tpl["system"]
    rules = "\n".join(f"- {r}" for r in tpl.get("rules", []))
    model = tpl.get("model") or prompt_mod.get_model()

    user_text = (
        "=== EXPENSE DIGEST ===\n"
        f"{digest}\n\n"
        "=== STYLE RULES ===\n"
        f"{rules}\n\n"
        "Write the spending summary now."
    )

    client = OpenAI(max_retries=8)
    response = client.chat.completions.create(
        model=model,
        timeout=120,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user_text},
        ],
    )
    return (response.choices[0].message.content or "").strip()


def summarize_expenses(
    classifications_csv: Path,
    line_items_csv: Path,
    output_dir: Path,
) -> Path | None:
    """Read the CSVs, narrate the spending, write summary.md. Returns the
    path written, or None when there's nothing to summarize yet."""
    digest = _build_digest(classifications_csv, line_items_csv)
    if digest is None:
        return None

    prose = _call_model(digest)

    output_dir.mkdir(parents=True, exist_ok=True)
    out_path = output_dir / "summary.md"
    out_path.write_text(
        "# Expense Summary\n\n"
        f"{prose}\n\n"
        "---\n\n"
        "## Underlying digest\n\n"
        "```\n"
        f"{digest}\n"
        "```\n",
        encoding="utf-8",
    )
    return out_path
