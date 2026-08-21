#!/usr/bin/env python3
"""
scraper/eval_extract.py
------------------------
Spot-check the extraction pipeline against a sample of REAL cases from the
database that already have accepted extractions (extraction_status IN
('full','low_confidence')).

For each sampled case:
  1. Fetch the stored judgment text (same logic as production).
  2. Call the live LLM via the refactored llm.call_llm.
  3. Compare the resulting fields against the previously-accepted extraction
     (field-level agreement) AND validate all enums round-trip correctly.

Results are written to eval_results.json next to this script.  That file
is committed as the post-refactor baseline; tests in test_extract.py load
it and assert quality thresholds.

Usage:
    cd scraper
    python3 eval_extract.py              # 10 cases (default)
    python3 eval_extract.py --n 20       # more cases
    python3 eval_extract.py --seed 42    # deterministic sample
    python3 eval_extract.py --dry-run    # show sampled cases, no LLM calls
"""

import argparse
import datetime
import json
import os
import random
import sys
import time

SCRAPER_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRAPER_DIR)

import pgdb           # noqa: E402
import llm            # noqa: E402
import extract        # noqa: E402
from judgements import clean_html  # noqa: E402

RESULTS_PATH = os.path.join(SCRAPER_DIR, "eval_results.json")

FIELDS_TO_COMPARE = [
    "issue_type", "sales_or_service", "outcome",
    "product_model", "is_ev", "warranty_related",
    "part_category", "part_involved",
]


def load_prior_extraction(case_row: dict) -> dict:
    """Parse the stored extracted JSON for a case row."""
    raw = (case_row.get("extracted") or "").strip()
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except Exception:
        return {}


def field_agreement(prior: dict, current: dict) -> dict:
    """
    Return per-field comparison between prior and current extractions.

    Only fields where at least one side is non-None are considered
    "contested" (i.e. carry information). Mutually-null fields are
    recorded separately so callers can report meaningful agreement
    without inflating the rate with null-null matches.

    Returns a dict with:
      "contested"       – {field: bool} for fields with ≥1 non-None value
      "both_null"       – set of field names where both sides are None
      "agree_contested" – count of contested fields that agree
      "total_contested" – total number of contested fields
    """
    contested: dict[str, bool] = {}
    both_null: set[str] = set()
    for f in FIELDS_TO_COMPARE:
        p, c = prior.get(f), current.get(f)
        if p is None and c is None:
            both_null.add(f)
        else:
            contested[f] = (p == c)
    agree_c = sum(contested.values())
    return {
        "contested":       contested,
        "both_null":       sorted(both_null),
        "agree_contested": agree_c,
        "total_contested": len(contested),
    }


def run_eval(n: int, seed: int, dry_run: bool) -> dict:
    random.seed(seed)
    conn = pgdb.get_connection()

    cur = conn.cursor()
    cur.execute("""
        SELECT c.case_number, c.extracted, c.extraction_status
        FROM cases c
        JOIN proceedings p ON p.case_number = c.case_number
        WHERE c.extraction_status IN ('full', 'low_confidence')
          AND length(trim(coalesce(c.extracted, ''))) > 10
          AND length(trim(coalesce(p.text_plain, ''))) > 200
        ORDER BY c.case_number
    """)
    pool = cur.fetchall()

    if not pool:
        print("[eval] No eligible cases found in the database.")
        return {"error": "no_eligible_cases", "n_sampled": 0, "cases": []}

    sample = random.sample(pool, min(n, len(pool)))
    print(f"[eval] Pool: {len(pool)} eligible cases  |  Sampling: {len(sample)}")
    llm.print_config()
    print()

    if dry_run:
        for row in sample:
            print(f"  [dry-run] {row['case_number']}  status={row['extraction_status']}")
        return {"dry_run": True, "cases": [r["case_number"] for r in sample]}

    results = []
    for i, row in enumerate(sample, 1):
        case_number = row["case_number"]
        prior = load_prior_extraction(row)

        text = extract.get_judgment_text(conn, case_number)
        if not text:
            print(f"  [{i}/{len(sample)}] {case_number}: no text, skipping")
            continue

        print(f"  [{i}/{len(sample)}] {case_number} ({len(text):,} chars) ...", end=" ", flush=True)
        t0 = time.time()
        try:
            raw, in_tok, out_tok, label, model_used = llm.call_llm(
                extract.SYSTEM_INSTRUCTION,
                f"JUDGMENT TEXT:\n\n{text}",
                temperature=0.1,
            )
        except Exception as exc:
            print(f"LLM FAILED: {exc}")
            results.append({
                "case_number": case_number,
                "status": "llm_error",
                "error": str(exc),
            })
            continue

        current = extract.parse_response(raw)
        elapsed = time.time() - t0

        if current is None:
            print(f"PARSE FAILED  ({in_tok}in/{out_tok}out tok, {elapsed:.1f}s)")
            results.append({
                "case_number": case_number,
                "status": "parse_failed",
                "raw_snippet": raw[:200],
                "in_tokens": in_tok,
                "out_tokens": out_tok,
            })
            continue

        conf = current.get("confidence")
        conf_str = f"conf={conf:.2f}" if isinstance(conf, float) else "conf=?"
        agr = field_agreement(prior, current)
        ag_c, tot_c = agr["agree_contested"], agr["total_contested"]
        agree_str = f"contested={ag_c}/{tot_c} null-null={len(agr['both_null'])}"

        print(f"OK  {conf_str}  {agree_str}  ({in_tok}in/{out_tok}out tok, {elapsed:.1f}s)")

        # Flag disagreements on contested fields
        for field, ok in agr["contested"].items():
            if not ok:
                print(f"       ↳ DISAGREE {field}: prior={prior.get(field)!r}  current={current.get(field)!r}")

        results.append({
            "case_number":       case_number,
            "status":            "ok",
            "model_used":        model_used,
            "in_tokens":         in_tok,
            "out_tokens":        out_tok,
            "confidence":        conf,
            "contested":         agr["contested"],
            "both_null":         agr["both_null"],
            "agree_contested":   ag_c,
            "total_contested":   tot_c,
            # Store the current and prior extraction for manual review
            "current_extraction": {k: current.get(k) for k in FIELDS_TO_COMPARE},
            "prior_extraction":   {k: prior.get(k) for k in FIELDS_TO_COMPARE},
        })

    conn.close()

    ok_cases   = [r for r in results if r["status"] == "ok"]
    total_ok   = len(ok_cases)
    parse_rate = total_ok / len(sample) if sample else 0.0

    # Average contested agreement: only cases where ≥1 field is contested
    contested_cases = [r for r in ok_cases if r["total_contested"] > 0]
    avg_agree_contested = (
        sum(r["agree_contested"] / r["total_contested"] for r in contested_cases)
        / len(contested_cases)
        if contested_cases else None
    )

    summary = {
        "generated_at":             datetime.datetime.utcnow().isoformat() + "Z",
        "model":                    llm.PRIMARY_MODEL,
        "n_sampled":                len(sample),
        "n_ok":                     total_ok,
        "n_parse_failed":           sum(1 for r in results if r["status"] == "parse_failed"),
        "n_llm_error":              sum(1 for r in results if r["status"] == "llm_error"),
        "parse_rate":               round(parse_rate, 4),
        "n_contested_cases":        len(contested_cases),
        "avg_contested_agreement":  round(avg_agree_contested, 4) if avg_agree_contested is not None else None,
        "cases": results,
    }

    print(f"\n[eval] SUMMARY")
    print(f"  Sampled:                {len(sample)}")
    print(f"  Parse success:          {total_ok} ({parse_rate:.0%})")
    if avg_agree_contested is not None:
        print(f"  Contested cases:        {len(contested_cases)}")
        print(f"  Avg contested agree:    {avg_agree_contested:.0%}  (non-null fields vs prior)")
    else:
        print(f"  Avg contested agree:    N/A (all fields null in every case)")
    print(f"  Written to:        {RESULTS_PATH}")

    return summary


def main():
    parser = argparse.ArgumentParser(description="Live eval: extraction pipeline vs real DB cases")
    parser.add_argument("--n",       type=int,  default=10, help="Number of cases to sample (default 10)")
    parser.add_argument("--seed",    type=int,  default=0,  help="Random seed for reproducible sample")
    parser.add_argument("--dry-run", action="store_true",   help="Show sampled cases without LLM calls")
    args = parser.parse_args()

    summary = run_eval(n=args.n, seed=args.seed, dry_run=args.dry_run)

    if args.dry_run:
        print("[eval] Dry-run mode: skipping write to eval_results.json (baseline preserved).")
    else:
        with open(RESULTS_PATH, "w", encoding="utf-8") as fh:
            json.dump(summary, fh, ensure_ascii=False, indent=2)
        print(f"[eval] Results written to {RESULTS_PATH}")


if __name__ == "__main__":
    main()
