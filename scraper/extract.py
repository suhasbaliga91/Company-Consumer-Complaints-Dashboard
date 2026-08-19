#!/usr/bin/env python3
"""
LLM Extraction Pipeline
-----------------------
Reads judgment/proceedings text for each case, calls the configured LLM to
extract structured classification fields, and writes results back to the
`cases` table in PostgreSQL.

Idempotent: skips already-extracted cases unless --force is passed.
Cases with confidence < CONFIDENCE_THRESHOLD → extraction_status='low_confidence'.

Usage:
    python3 extract.py                           # process all unextracted cases
    python3 extract.py --sample 10               # process first 10 eligible cases
    python3 extract.py --force                   # re-extract all (clears previous)
    python3 extract.py --offset 200 --limit 200  # batch: skip first 200, take next 200
    python3 extract.py --concurrency 5           # parallel LLM calls (default: 5)

LLM configuration is read from environment variables — see scraper/llm.py for the
full list.  Quick start:
    GEMINI_API_KEY=<your-key>   python3 extract.py   # Gemini primary (default)
    OPENAI_API_KEY=<your-key>   python3 extract.py   # OpenAI primary
"""

import argparse
import importlib
import json
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional

import datetime
import requests as http
import pgdb
from judgements import clean_html
import llm

# Classification taxonomy — set TAXONOMY_MODULE in the environment to swap
# to a different industry's issue/part categories and prompt examples.
_taxonomy = importlib.import_module(os.environ.get("TAXONOMY_MODULE", "taxonomy"))

# ------------------------------------------------------------------
# Configuration
# ------------------------------------------------------------------

MAX_TEXT_CHARS       = 25000
MIN_TEXT_CHARS       = 0
CONFIDENCE_THRESHOLD = 0.35

# Target company — set COMPANY_NAME in the environment to override.
# Injected into the extraction system prompt so the LLM knows which
# manufacturer's cases it is analysing.
COMPANY_NAME = os.environ.get("COMPANY_NAME", "the respondent")

# ------------------------------------------------------------------
# Token / cost tracking
#
# _token_input / _token_output are cumulative counts across all calls
# (for display in the summary log).  _run_cost_usd accumulates the
# model-accurate cost so daily-cap enforcement is correct even when
# the fallback provider runs at a different rate than the primary.
# ------------------------------------------------------------------

TOKEN_LOG_PATH = os.path.join(os.path.dirname(__file__), "token_usage.jsonl")

# Hard daily spend cap — set TOKEN_DAILY_CAP_USD in the environment to override.
TOKEN_DAILY_CAP_USD = float(os.environ.get("TOKEN_DAILY_CAP_USD", "10.0"))

_token_input   = 0
_token_output  = 0
_run_cost_usd  = 0.0
_token_lock    = threading.Lock()
_cap_hit       = threading.Event()   # set when daily cap is reached


def _add_tokens(model: str, in_tok: int, out_tok: int) -> None:
    """Thread-safely accumulate token counts and model-accurate cost."""
    global _token_input, _token_output, _run_cost_usd
    inp_rate, out_rate = llm.get_pricing(model)
    call_cost = (in_tok / 1_000_000 * inp_rate) + (out_tok / 1_000_000 * out_rate)
    with _token_lock:
        _token_input  += in_tok
        _token_output += out_tok
        _run_cost_usd += call_cost

# ------------------------------------------------------------------
# Allowed enum values — sourced from the taxonomy module (see TAXONOMY_MODULE
# above). Exposed here as module attributes so validate_enums() below, and
# callers/tests that reference extract.VALID_*, keep working unchanged.
# ------------------------------------------------------------------

VALID_ISSUE_TYPES      = _taxonomy.VALID_ISSUE_TYPES
VALID_OUTCOME_VALUES    = _taxonomy.VALID_OUTCOME_VALUES
VALID_SALES_OR_SERVICE  = _taxonomy.VALID_SALES_OR_SERVICE
VALID_PART_CATEGORIES   = _taxonomy.VALID_PART_CATEGORIES

# ------------------------------------------------------------------
# Prompt
# ------------------------------------------------------------------

_fd = _taxonomy.FIELD_DESCRIPTIONS

SYSTEM_INSTRUCTION = f"""You are a legal analyst reviewing Indian consumer-court judgments involving {COMPANY_NAME}. Extract structured fields from the provided judgment text and return ONLY a valid JSON object.

LANGUAGE NOTE: The judgment text may be in English, Hindi, Marathi, Tamil, Telugu, Kannada, Bengali, Gujarati, or any other Indian language. Extract fields by reading and understanding the text in its original language — do NOT return null for a field simply because the text is not in English. Apply the same extraction logic regardless of language.

ALLOWED VALUES (use exactly as written, or null if not applicable):
- issue_type: {sorted(VALID_ISSUE_TYPES)}
- outcome: {sorted(VALID_OUTCOME_VALUES)}
- sales_or_service: ["Sales", "Service"]
- part_category: {sorted(VALID_PART_CATEGORIES)}

FIELDS TO EXTRACT:
- issue_type (string|null): primary complaint category from the allowed list, null if genuinely unclear after reading the full text
- sales_or_service (string|null): "Sales" for purchase/delivery issues; "Service" for post-sale repair/maintenance; null if genuinely unclear
- warranty_related (boolean|null): true if warranty or AMC is central to the complaint
- product_model (string|null): {_fd["product_model"]}
- is_ev (boolean|null): {_fd["is_ev"]}
- part_involved (string|null): {_fd["part_involved"]}
- part_category (string|null): broader category from allowed list; null if not applicable
- dealership (string|null): {_fd["dealership"]}
- outcome (string|null): final outcome from allowed list; null if genuinely unclear
- claim_amount (number|null): amount claimed by complainant in INR, plain number; null if not mentioned
- amount_awarded (number|null): amount directed to be paid in INR, plain number; null if no award
- grounds_taken (array of strings|null): up to 5 key legal grounds in English regardless of source language; null if not extractable
- confidence (number): your confidence 0.0–1.0 that the extracted fields are correct; set 0.7+ when you can read and understand the full text, even in a regional language
- source_snippet (string|null): verbatim excerpt (max 200 chars) in the original language supporting the key finding

{_taxonomy.FEW_SHOT_EXAMPLES}

Return ONLY a JSON object. No markdown fences. No commentary."""


# ------------------------------------------------------------------
# Schema migration (no-op — schema managed by PostgreSQL DDL)
# ------------------------------------------------------------------

def migrate(con) -> None:
    pass  # All columns present in the PostgreSQL schema from the start


# ------------------------------------------------------------------
# Judgment text fetching
# ------------------------------------------------------------------

def get_judgment_text(con, case_number: str) -> str:
    """Return the best available text for a case, capped at MAX_TEXT_CHARS."""
    cur = con.cursor()
    cur.execute(
        "SELECT judgement_text, order_body FROM judgements "
        "WHERE case_number=%s AND length(trim(coalesce(judgement_text,''))) > 0 "
        "LIMIT 1",
        (case_number,)
    )
    judg_row = cur.fetchone()

    judg_text = ""
    if judg_row:
        jt = (judg_row["judgement_text"] or "").strip()
        # order_body is raw HTML; strip tags before comparing length or truncating
        ob = clean_html(judg_row["order_body"] or "").strip()
        judg_text = ob if len(ob) >= len(jt) * 0.5 else jt

    # Best proceedings text (final orders first, then any proceeding)
    cur2 = con.cursor()
    cur2.execute(
        "SELECT text_plain FROM proceedings "
        "WHERE case_number=%s AND order_type=2 AND length(trim(coalesce(text_plain,''))) > 0 "
        "ORDER BY length(text_plain) DESC LIMIT 1",
        (case_number,)
    )
    proc_rows = cur2.fetchall()
    if not proc_rows:
        cur3 = con.cursor()
        cur3.execute(
            "SELECT text_plain FROM proceedings "
            "WHERE case_number=%s AND length(trim(coalesce(text_plain,''))) > 0 "
            "ORDER BY length(text_plain) DESC LIMIT 1",
            (case_number,)
        )
        proc_rows = cur3.fetchall()
    proc_text = (proc_rows[0]["text_plain"] or "").strip() if proc_rows else ""

    best = judg_text if len(judg_text) >= len(proc_text) else proc_text
    return best[:MAX_TEXT_CHARS]

# ------------------------------------------------------------------
# Enum validation + type coercion
# ------------------------------------------------------------------

def validate_enums(data: dict) -> dict:
    if data.get("issue_type")       not in VALID_ISSUE_TYPES:      data["issue_type"]       = None
    if data.get("outcome")          not in VALID_OUTCOME_VALUES:   data["outcome"]          = None
    if data.get("sales_or_service") not in VALID_SALES_OR_SERVICE: data["sales_or_service"] = None
    if data.get("part_category")    not in VALID_PART_CATEGORIES:  data["part_category"]    = None
    for f in ("claim_amount", "amount_awarded", "confidence"):
        v = data.get(f)
        if v is not None:
            try:    data[f] = float(v)
            except: data[f] = None
    for f in ("warranty_related", "is_ev"):
        v = data.get(f)
        if v is not None:
            data[f] = v.lower() in ("true", "yes", "1") if isinstance(v, str) else bool(v)
    if "grounds_taken" in data and not isinstance(data.get("grounds_taken"), (list, type(None))):
        data["grounds_taken"] = None
    return data


def parse_response(text: str) -> Optional[dict]:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*```$", "", text).strip()
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", text, re.DOTALL)
        if not m:
            return None
        try:    data = json.loads(m.group())
        except: return None
    if not isinstance(data, dict):
        return None
    return validate_enums(data)

# ------------------------------------------------------------------
# LLM extraction
# ------------------------------------------------------------------

def extract_case(text: str) -> Optional[dict]:
    """Call the LLM to extract structured fields from a judgment text."""
    user_prompt = f"JUDGMENT TEXT:\n\n{text}"
    for attempt in range(1, 4):
        try:
            raw, in_tok, out_tok, _label, model_used = llm.call_llm(
                SYSTEM_INSTRUCTION,
                user_prompt,
                # Use the default retry_attempts (3) per provider so transient
                # failures are retried before the fallback is triggered.
            )
            _add_tokens(model_used, in_tok, out_tok)
            result = parse_response(raw)
            if result is not None:
                return result
            print(f"    [warn] parse failed (attempt {attempt}): {raw[:120]!r}")
        except llm.LLMError as e:
            print(f"    [error] all LLM providers failed (attempt {attempt}): {e}")
            return None
        except Exception as e:
            print(f"    [warn] unexpected error (attempt {attempt}): {e}")
        if attempt < 3:
            time.sleep(2.0 * attempt)
    return None

# ------------------------------------------------------------------
# Thread-safe helpers
# ------------------------------------------------------------------

_print_lock = threading.Lock()

def safe_print(*args, **kwargs):
    with _print_lock:
        print(*args, **kwargs)

def _get_today_spend_from_log() -> float:
    """Return the sum of cost_usd for all log entries dated today (UTC)."""
    today = datetime.datetime.utcnow().strftime("%Y-%m-%d")
    total = 0.0
    try:
        with open(TOKEN_LOG_PATH) as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                    if rec.get("ts", "").startswith(today):
                        total += rec.get("cost_usd", 0.0)
                except Exception:
                    pass
    except FileNotFoundError:
        pass
    return total

def _current_run_cost() -> float:
    """Return the model-accurate USD cost accumulated in the current run so far."""
    return _run_cost_usd


def _log_token_usage(script: str, cases_done: int, today_prior: float) -> None:
    """Print a token-usage/cost summary and append a record to token_usage.jsonl."""
    cost = _current_run_cost()
    today_total = today_prior + cost
    cap_note = f"  |  Daily cap: ${TOKEN_DAILY_CAP_USD:.2f} USD  |  Today total: ${today_total:.4f} USD"
    print(
        f"\n[token_usage] Model: {llm.PRIMARY_MODEL}"
        f"  |  Input tokens: {_token_input:,}"
        f"  |  Output tokens: {_token_output:,}"
        f"  |  Total: {_token_input + _token_output:,}"
        f"  |  Est. cost: ${cost:.4f} USD"
        + cap_note
    )
    entry = {
        "ts":            datetime.datetime.utcnow().isoformat() + "Z",
        "script":        script,
        "model":         llm.PRIMARY_MODEL,
        "input_tokens":  _token_input,
        "output_tokens": _token_output,
        "total_tokens":  _token_input + _token_output,
        "cost_usd":      round(cost, 6),
        "cases_done":    cases_done,
    }
    try:
        with open(TOKEN_LOG_PATH, "a") as fh:
            fh.write(json.dumps(entry) + "\n")
        print(f"[token_usage] Appended to {TOKEN_LOG_PATH}")
    except Exception as e:
        print(f"[token_usage] Could not write log: {e}")

def run(sample: Optional[int], force: bool, redo_prior: bool = False, offset: int = 0,
        limit: Optional[int] = None, concurrency: int = 5) -> None:
    llm.check_config()

    global _token_input, _token_output, _run_cost_usd
    _token_input  = 0
    _token_output = 0
    _run_cost_usd = 0.0
    _cap_hit.clear()

    today_prior_spend = _get_today_spend_from_log()

    main_con = pgdb.get_connection()
    migrate(main_con)

    base_status = "sample" if sample else "full"

    llm.print_config()
    print(f"[extract] Daily cap: ${TOKEN_DAILY_CAP_USD:.2f} USD"
          f"  |  Already spent today: ${today_prior_spend:.4f} USD"
          f"  |  Remaining: ${max(0.0, TOKEN_DAILY_CAP_USD - today_prior_spend):.4f} USD")

    # --- Before counts (for --redo-prior summary) ---
    if redo_prior:
        cur = main_con.cursor()
        cur.execute(
            "SELECT COUNT(*) FROM cases WHERE extraction_status IN ('full','low_confidence','sample')"
            " AND (NULLIF(extracted,'')::json->>'issue_type') IS NULL"
        )
        before_null_issue = cur.fetchone()[0]
        cur.execute(
            "SELECT COUNT(*) FROM cases WHERE extraction_status IN ('full','low_confidence','sample')"
            " AND (NULLIF(extracted,'')::json->>'outcome') IS NULL"
        )
        before_null_outcome = cur.fetchone()[0]
        cur.execute(
            "SELECT COUNT(*) FROM cases WHERE extraction_status IN ('full','low_confidence','sample')"
            " AND (NULLIF(extracted,'')::json->>'sales_or_service') IS NULL"
        )
        before_null_sos = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM cases WHERE extraction_status='low_confidence'")
        before_lc = cur.fetchone()[0]
        print(f"[extract] BEFORE — null issue_type: {before_null_issue}, "
              f"null outcome: {before_null_outcome}, "
              f"null sales_or_service: {before_null_sos}, "
              f"low_confidence: {before_lc}")

    if force:
        query = """
            SELECT DISTINCT c.case_number
            FROM cases c
            JOIN proceedings p ON p.case_number = c.case_number
            WHERE length(trim(coalesce(p.text_plain,''))) > 0
            ORDER BY c.case_number
        """
    elif redo_prior:
        query = """
            SELECT DISTINCT c.case_number
            FROM cases c
            JOIN proceedings p ON p.case_number = c.case_number
            WHERE length(trim(coalesce(p.text_plain,''))) > 0
              AND c.extraction_status IN ('full', 'low_confidence', 'sample')
            ORDER BY c.case_number
        """
    else:
        query = """
            SELECT DISTINCT c.case_number
            FROM cases c
            JOIN proceedings p ON p.case_number = c.case_number
            WHERE length(trim(coalesce(p.text_plain,''))) > 0
              AND (c.extraction_status IS NULL OR c.extraction_status = ''
                   OR c.extraction_status = 'text_too_short')
            ORDER BY c.case_number
        """

    cur2 = main_con.cursor()
    cur2.execute(query)
    candidates = [row["case_number"] for row in cur2.fetchall()]
    main_con.close()

    if offset:
        candidates = candidates[offset:]
    if sample:
        candidates = candidates[:sample]
    elif limit:
        candidates = candidates[:limit]

    total   = len(candidates)
    done    = 0
    failed  = 0
    skipped = 0
    counters_lock = threading.Lock()

    mode_str = ""
    if force:       mode_str += "--force "
    if redo_prior:  mode_str += "--redo-prior "
    if sample:      mode_str += f"--sample {sample} "
    if offset:      mode_str += f"--offset {offset} "
    if limit:       mode_str += f"--limit {limit} "
    mode_str = mode_str or "full"

    print(f"[extract] Eligible: {total}  |  Mode: {mode_str}  |  Concurrency: {concurrency}\n")

    def get_thread_con():
        return pgdb.get_thread_connection()

    def process_one(idx_case):
        nonlocal done, failed, skipped
        i, case_number = idx_case

        # Bail out immediately if the daily cap was already hit by a previous case.
        if _cap_hit.is_set():
            safe_print(f"  [{i}/{total}] {case_number}: daily cap reached, skipping")
            with counters_lock:
                skipped += 1
            return

        tcon = get_thread_con()
        text = get_judgment_text(tcon, case_number)

        if len(text) == 0:
            safe_print(f"  [{i}/{total}] {case_number}: no text at all, skipping")
            upd = tcon.cursor()
            upd.execute(
                "UPDATE cases SET extraction_status='text_too_short', extracted_at=%s WHERE case_number=%s",
                (time.time(), case_number)
            )
            with counters_lock:
                skipped += 1
            return

        safe_print(f"  [{i}/{total}] {case_number} ({len(text):,} chars) ...")
        result = extract_case(text)

        if result is None:
            safe_print(f"  [{i}/{total}] {case_number} FAILED")
            with counters_lock:
                failed += 1
            return

        conf_val   = result.get("confidence")
        conf_float = float(conf_val) if isinstance(conf_val, (int, float)) else None
        final_status = (
            "low_confidence"
            if (conf_float is not None and conf_float < CONFIDENCE_THRESHOLD)
            else base_status
        )

        upd = tcon.cursor()
        upd.execute(
            "UPDATE cases SET extracted=%s, extraction_status=%s, extracted_at=%s WHERE case_number=%s",
            (json.dumps(result), final_status, time.time(), case_number)
        )

        conf_str = f"conf={conf_float:.2f}" if conf_float is not None else "conf=?"
        lc_flag  = " [LOW-CONF]" if final_status == "low_confidence" else ""
        safe_print(f"  [{i}/{total}] {case_number} OK ({conf_str}){lc_flag}")
        with counters_lock:
            done += 1

        # Check daily cap after this case's tokens are accumulated.
        if not _cap_hit.is_set() and (today_prior_spend + _current_run_cost()) >= TOKEN_DAILY_CAP_USD:
            _cap_hit.set()
            safe_print(
                f"\n[token_usage] *** Daily cap of ${TOKEN_DAILY_CAP_USD:.2f} USD reached"
                f" — no further LLM calls will be made this run ***\n"
            )

    indexed = list(enumerate(candidates, 1))
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        futures = [pool.submit(process_one, ic) for ic in indexed]
        for fut in as_completed(futures):
            exc = fut.exception()
            if exc:
                safe_print(f"  [error] unexpected: {exc}")

    print(f"\n[extract] Done — {done} extracted, {failed} failed, {skipped} too-short")

    rcon = pgdb.get_connection()
    rcur = rcon.cursor()
    rcur.execute("SELECT COUNT(*) FROM cases WHERE extraction_status='low_confidence'")
    lc   = rcur.fetchone()[0]
    rcur.execute("SELECT COUNT(*) FROM cases WHERE extraction_status=%s", (base_status,))
    good = rcur.fetchone()[0]
    print(f"[extract] DB totals: {good} '{base_status}', {lc} 'low_confidence'")

    if redo_prior:
        rcur.execute(
            "SELECT COUNT(*) FROM cases WHERE extraction_status IN ('full','low_confidence','sample')"
            " AND (NULLIF(extracted,'')::json->>'issue_type') IS NULL"
        )
        after_null_issue = rcur.fetchone()[0]
        rcur.execute(
            "SELECT COUNT(*) FROM cases WHERE extraction_status IN ('full','low_confidence','sample')"
            " AND (NULLIF(extracted,'')::json->>'outcome') IS NULL"
        )
        after_null_outcome = rcur.fetchone()[0]
        rcur.execute(
            "SELECT COUNT(*) FROM cases WHERE extraction_status IN ('full','low_confidence','sample')"
            " AND (NULLIF(extracted,'')::json->>'sales_or_service') IS NULL"
        )
        after_null_sos = rcur.fetchone()[0]
        print(f"\n[extract] AFTER  — null issue_type: {after_null_issue} (was {before_null_issue}), "
              f"null outcome: {after_null_outcome} (was {before_null_outcome}), "
              f"null sales_or_service: {after_null_sos} (was {before_null_sos}), "
              f"low_confidence: {lc} (was {before_lc})")
        print(f"[extract] Fill-rate improvement — "
              f"issue_type: {before_null_issue - after_null_issue} newly filled, "
              f"outcome: {before_null_outcome - after_null_outcome} newly filled, "
              f"low_confidence resolved: {before_lc - lc}")

    rcon.close()

    _log_token_usage("extract.py", done, today_prior_spend)

    if done > 0:
        _invalidate_api_cache()

    print()


def _invalidate_api_cache() -> None:
    secret = os.environ.get("CACHE_SECRET", "")
    if not secret:
        print("[extract] CACHE_SECRET not set — skipping API cache invalidation")
        return
    # API_BASE_URL is canonical (matches refresh.py/.env.example); API_SERVER_URL
    # is accepted as a legacy alias for backward compatibility.
    api_base = (os.environ.get("API_BASE_URL") or os.environ.get("API_SERVER_URL")
                or "http://localhost:8080")
    url = f"{api_base}/api/cache/invalidate"
    try:
        resp = http.post(url, headers={"x-cache-secret": secret}, timeout=10)
        if resp.status_code == 204:
            print(f"[extract] API cache invalidated ({url})")
        else:
            print(f"[extract] Cache invalidation returned {resp.status_code}: {resp.text[:120]}")
    except Exception as e:
        print(f"[extract] Cache invalidation failed: {e}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="LLM Extraction Pipeline")
    parser.add_argument("--sample",      type=int,  default=None)
    parser.add_argument("--force",       action="store_true")
    parser.add_argument("--redo-prior",  action="store_true")
    parser.add_argument("--offset",      type=int,  default=0)
    parser.add_argument("--limit",       type=int,  default=None)
    parser.add_argument("--concurrency", type=int,  default=5)
    args = parser.parse_args()

    run(sample=args.sample, force=args.force, redo_prior=args.redo_prior,
        offset=args.offset, limit=args.limit, concurrency=args.concurrency)
