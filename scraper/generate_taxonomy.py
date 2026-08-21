#!/usr/bin/env python3
"""
generate_taxonomy.py — LLM-assisted bootstrap for a new industry's taxonomy.py.

taxonomy.py ships with an automotive-industry classification taxonomy (issue
types, part categories, field phrasing, few-shot examples). Rather than
hand-authoring a new one for a different industry, this script samples
already-harvested judgment text for the configured company (falling back to
just COMPANY_NAME if nothing has been harvested yet) and asks the
already-configured LLM — same LLM_PRIMARY_PROVIDER/LLM_PRIMARY_MODEL that
extract.py uses, no separate model config needed — to draft an
industry-appropriate taxonomy in the same shape as taxonomy.py.

This NEVER overwrites taxonomy.py. It writes a draft to taxonomy_generated.py
(or --out) for human review. Once you've reviewed/edited it, activate it with:

    TAXONOMY_MODULE=taxonomy_generated python3 extract.py

Usage:
    python3 generate_taxonomy.py                  # sample up to 25 harvested cases
    python3 generate_taxonomy.py --sample 50
    python3 generate_taxonomy.py --out taxonomy_banking.py
"""

import argparse
import json
import os
import re
import sys

import llm
import taxonomy as _default_taxonomy

COMPANY_NAME = (
    os.environ.get("COMPANY_NAME")
    or os.environ.get("OPPOSITE_PARTY")
    or "the respondent"
)


# ------------------------------------------------------------------
# Sampling
# ------------------------------------------------------------------

def _sample_judgment_texts(n: int) -> list[str]:
    """Best-effort sample of already-harvested judgment text; [] if unavailable."""
    try:
        import pgdb
        from judgements import clean_html
    except Exception as exc:
        print(f"[generate_taxonomy] DB/imports unavailable ({exc}); proceeding without samples.")
        return []

    try:
        con = pgdb.get_connection()
    except Exception as exc:
        print(f"[generate_taxonomy] Could not connect to DATABASE_URL ({exc}); proceeding without samples.")
        return []

    try:
        cur = con.cursor()
        cur.execute(
            """
            SELECT DISTINCT p.text_plain
            FROM proceedings p
            WHERE length(trim(coalesce(p.text_plain,''))) > 200
            ORDER BY random()
            LIMIT %s
            """,
            (n,),
        )
        rows = cur.fetchall()
    finally:
        con.close()

    texts = [clean_html(r["text_plain"] or "").strip()[:3000] for r in rows]
    return [t for t in texts if t]


# ------------------------------------------------------------------
# Meta-prompt
# ------------------------------------------------------------------

META_PROMPT_TEMPLATE = """You are helping configure an LLM extraction pipeline that reads Indian consumer-court judgments and classifies them into structured fields, for a company called "{company}".

{sample_block}

Design an industry-appropriate classification taxonomy for this company, returned as a single JSON object with EXACTLY this shape:

{{
  "valid_issue_types": [array of 4-8 short category strings covering the most common complaint types for this company's industry; MUST include "Other" as the last entry],
  "valid_part_categories": [array of short sub-component/product-area category strings IF a "which part/component of the product failed" concept genuinely applies to this industry (e.g. it applies to vehicles, appliances, electronics; it does NOT apply to banking, insurance, or pure services) — include "Other" as the last entry if non-empty; return an EMPTY array [] if the concept does not apply to this industry at all],
  "field_descriptions": {{
    "product_model": "one-sentence description of what this free-text field should capture for this industry, in the style: 'specific <thing> (e.g. \\"Example A\\", \\"Example B\\"); null if not mentioned'",
    "is_ev": "one-sentence description; if 'electric vehicle' is not a meaningful concept for this industry, describe it as always null / not applicable instead of forcing a vehicle-specific meaning",
    "part_involved": "one-sentence description matching this industry's product/service (or 'not applicable; always null' if valid_part_categories is empty)",
    "dealership": "one-sentence description of the equivalent distribution/service-point concept for this industry (e.g. branch, agent, vendor, retailer) instead of assuming a vehicle dealership"
  }},
  "examples": [
    {{"language": "English", "input": "a realistic 2-4 sentence judgment excerpt in the style of an Indian consumer-court order, using the fields above", "output": {{"issue_type": "...", "sales_or_service": "Sales or Service", "warranty_related": true, "product_model": "... or null", "is_ev": null, "part_involved": "... or null", "part_category": "... or null", "dealership": "... or null", "outcome": "Allowed", "claim_amount": 50000, "amount_awarded": 45000, "grounds_taken": ["...", "..."], "confidence": 0.85, "source_snippet": "short verbatim-style excerpt"}}}}
  ]  // 2-3 examples total; at least one non-English (Hindi or Marathi) if you can write it accurately, otherwise all English

}}

"outcome" must be one of: {outcomes}. "sales_or_service" must be "Sales" or "Service".

Return ONLY the JSON object. No markdown fences, no commentary."""


def _build_prompt(samples: list[str]) -> str:
    if samples:
        joined = "\n\n---\n\n".join(f"Sample judgment {i + 1}:\n{s}" for i, s in enumerate(samples))
        sample_block = (
            f"Here are {len(samples)} real judgment excerpts already harvested for this company, "
            f"to ground your taxonomy in what actually appears in their cases:\n\n{joined}"
        )
    else:
        sample_block = (
            "No judgment text has been harvested yet for this company, so design the taxonomy from "
            "general knowledge of what kinds of consumer disputes are typical for a company like this."
        )
    return META_PROMPT_TEMPLATE.format(
        company=COMPANY_NAME,
        sample_block=sample_block,
        outcomes=sorted(_default_taxonomy.VALID_OUTCOME_VALUES),
    )


def _parse_json_response(text: str) -> dict:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*```$", "", text).strip()
    return json.loads(text)


# ------------------------------------------------------------------
# Validation
# ------------------------------------------------------------------

REQUIRED_FIELD_DESCRIPTION_KEYS = {"product_model", "is_ev", "part_involved", "dealership"}


def _validate(data: dict) -> list[str]:
    """Return a list of problems; empty list means the draft is well-formed."""
    problems = []

    issue_types = data.get("valid_issue_types")
    if not isinstance(issue_types, list) or not issue_types:
        problems.append("valid_issue_types must be a non-empty array")
    elif "Other" not in issue_types:
        problems.append('valid_issue_types must include "Other"')

    part_categories = data.get("valid_part_categories")
    if not isinstance(part_categories, list):
        problems.append("valid_part_categories must be an array (use [] if not applicable)")
    elif part_categories and "Other" not in part_categories:
        problems.append('valid_part_categories must include "Other" when non-empty')

    field_desc = data.get("field_descriptions")
    if not isinstance(field_desc, dict) or set(field_desc) != REQUIRED_FIELD_DESCRIPTION_KEYS:
        problems.append(f"field_descriptions must have exactly these keys: {sorted(REQUIRED_FIELD_DESCRIPTION_KEYS)}")

    examples = data.get("examples")
    if not isinstance(examples, list) or not examples:
        problems.append("examples must be a non-empty array")
    else:
        issue_set = set(issue_types) if isinstance(issue_types, list) else set()
        part_set = set(part_categories) if isinstance(part_categories, list) else set()
        for i, ex in enumerate(examples):
            if not isinstance(ex, dict) or "input" not in ex or "output" not in ex:
                problems.append(f"examples[{i}] must have 'language', 'input', and 'output' keys")
                continue
            out = ex["output"]
            if issue_set and out.get("issue_type") not in issue_set:
                problems.append(f"examples[{i}].output.issue_type {out.get('issue_type')!r} not in generated valid_issue_types — coercing to 'Other'")
                out["issue_type"] = "Other" if "Other" in issue_set else next(iter(issue_set))
            if part_set and out.get("part_category") is not None and out.get("part_category") not in part_set:
                problems.append(f"examples[{i}].output.part_category {out.get('part_category')!r} not in generated valid_part_categories — nulling it")
                out["part_category"] = None
            if not part_set:
                out["part_category"] = None

    return problems


# ------------------------------------------------------------------
# Rendering — always writes Python-safe string literals via json.dumps,
# so nothing from the LLM response is ever exec'd or interpolated raw.
# ------------------------------------------------------------------

def _render(data: dict, company: str) -> str:
    issue_types = data["valid_issue_types"]
    part_categories = data["valid_part_categories"]
    field_desc = data["field_descriptions"]
    examples = data["examples"]

    lines = [
        '"""',
        f"taxonomy_generated.py — LLM-drafted classification taxonomy for {company}.",
        "",
        "Generated by generate_taxonomy.py. This is a DRAFT for human review — read every",
        "field below, correct anything that looks wrong, then activate it with:",
        "",
        "    TAXONOMY_MODULE=taxonomy_generated python3 extract.py",
        "",
        'See taxonomy.py for the full explanation of what each constant controls.',
        '"""',
        "",
        "VALID_ISSUE_TYPES = {",
    ]
    for v in issue_types:
        lines.append(f"    {json.dumps(v, ensure_ascii=False)},")
    lines.append("}")
    lines.append("")

    lines.append("# Kept identical to taxonomy.py — outcome/sales_or_service are domain-generic.")
    lines.append("VALID_OUTCOME_VALUES = {")
    for v in sorted(_default_taxonomy.VALID_OUTCOME_VALUES):
        lines.append(f"    {json.dumps(v, ensure_ascii=False)},")
    lines.append("}")
    lines.append("")
    lines.append("VALID_SALES_OR_SERVICE = {")
    for v in sorted(_default_taxonomy.VALID_SALES_OR_SERVICE):
        lines.append(f"    {json.dumps(v, ensure_ascii=False)},")
    lines.append("}")
    lines.append("")

    if part_categories:
        lines.append("VALID_PART_CATEGORIES = {")
        for v in part_categories:
            lines.append(f"    {json.dumps(v, ensure_ascii=False)},")
        lines.append("}")
    else:
        lines.append("# Not applicable to this industry — part_category will always be null.")
        lines.append("VALID_PART_CATEGORIES = set()")
    lines.append("")

    lines.append("FIELD_DESCRIPTIONS = {")
    for k in ("product_model", "is_ev", "part_involved", "dealership"):
        lines.append(f"    {json.dumps(k)}: {json.dumps(field_desc[k], ensure_ascii=False)},")
    lines.append("}")
    lines.append("")

    example_blocks = []
    for i, ex in enumerate(examples, start=1):
        lang = ex.get("language", "English")
        input_text = ex["input"]
        output_json = json.dumps(ex["output"], separators=(",", ":"), ensure_ascii=False)
        example_blocks.append(
            f"EXAMPLE {i} — {lang}:\n"
            f"Input: {json.dumps(input_text, ensure_ascii=False)}\n"
            f"Output: {output_json}"
        )
    few_shot_text = "\n\n".join(example_blocks)
    lines.append(f"FEW_SHOT_EXAMPLES = {json.dumps(few_shot_text, ensure_ascii=False)}")
    lines.append("")

    return "\n".join(lines)


# ------------------------------------------------------------------
# Diff summary
# ------------------------------------------------------------------

def _print_diff_summary(data: dict) -> None:
    print("\n[generate_taxonomy] Summary vs. the shipped automotive default (taxonomy.py):")
    print(f"  issue types:  default={sorted(_default_taxonomy.VALID_ISSUE_TYPES)}")
    print(f"                generated={sorted(data['valid_issue_types'])}")
    print(f"  part categories: default={sorted(_default_taxonomy.VALID_PART_CATEGORIES)}")
    pc = data["valid_part_categories"]
    print(f"                   generated={sorted(pc) if pc else '[] (not applicable to this industry)'}")
    for field in ("product_model", "is_ev", "part_involved", "dealership"):
        print(f"  {field}: {data['field_descriptions'][field]}")


# ------------------------------------------------------------------
# Main
# ------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="LLM-assisted taxonomy bootstrap")
    parser.add_argument("--sample", type=int, default=25, help="number of harvested judgment texts to sample (default: 25)")
    parser.add_argument("--out", default="taxonomy_generated.py", help="output path (default: taxonomy_generated.py)")
    args = parser.parse_args()

    llm.check_config()
    llm.print_config()

    samples = _sample_judgment_texts(args.sample)
    print(f"[generate_taxonomy] Sampled {len(samples)} judgment excerpt(s) for {COMPANY_NAME!r}.")

    prompt = _build_prompt(samples)
    raw, in_tok, out_tok, provider, model = llm.call_llm(
        system_prompt="You are an expert in Indian consumer law and product/industry taxonomy design. Respond only with valid JSON.",
        user_prompt=prompt,
        temperature=0.3,
    )
    print(f"[generate_taxonomy] {provider}:{model} — {in_tok} in / {out_tok} out tokens")

    try:
        data = _parse_json_response(raw)
    except json.JSONDecodeError as exc:
        print(f"[generate_taxonomy] ERROR: LLM response was not valid JSON: {exc}")
        print(raw[:2000])
        sys.exit(1)

    problems = _validate(data)
    for p in problems:
        print(f"[generate_taxonomy] WARNING: {p}")
    if any("must" in p for p in problems):
        print("[generate_taxonomy] Draft has structural problems (see WARNINGs above) — not writing output. Re-run.")
        sys.exit(1)

    _print_diff_summary(data)

    rendered = _render(data, COMPANY_NAME)
    with open(args.out, "w", encoding="utf-8") as fh:
        fh.write(rendered)

    print(f"\n[generate_taxonomy] Wrote draft to {args.out}")
    print("[generate_taxonomy] This is a DRAFT — review every field before activating it.")
    print(f"[generate_taxonomy] Once reviewed, activate with: TAXONOMY_MODULE={os.path.splitext(os.path.basename(args.out))[0]} python3 extract.py")


if __name__ == "__main__":
    main()
