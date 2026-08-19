#!/usr/bin/env python3
"""
Dealership Respondent Extraction Pipeline
-----------------------------------------
Lightweight LLM pass over the `respondent` field of ALL cases to extract
a clean, normalised dealership name → `dealership_canonical` column.

One short LLM call per case.  Idempotent: skips cases that already have
a value unless --force is passed.

Usage:
    python3 extract_respondents.py              # all unextracted
    python3 extract_respondents.py --sample 20
    python3 extract_respondents.py --force
    python3 extract_respondents.py --concurrency 4

LLM configuration is read from environment variables — see scraper/llm.py for the
full list.  Quick start:
    GEMINI_API_KEY=<your-key>   python3 extract_respondents.py   # Gemini (default)
    OPENAI_API_KEY=<your-key>   python3 extract_respondents.py   # OpenAI primary
"""

import argparse
import datetime
import json
import os
import re
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional

import pgdb
import llm


# ------------------------------------------------------------------
# Configuration
# ------------------------------------------------------------------

RETRY_ATTEMPTS = 3
RETRY_DELAY    = 1.5

# ------------------------------------------------------------------
# Token / cost tracking
#
# _token_input / _token_output are cumulative counts across all calls
# (for display).  _run_cost_usd accumulates the model-accurate cost so
# daily-cap enforcement is correct even when the fallback provider runs
# at a different rate than the primary.
# ------------------------------------------------------------------

TOKEN_LOG_PATH = os.path.join(os.path.dirname(__file__), "token_usage.jsonl")

# Hard daily spend cap — set TOKEN_DAILY_CAP_USD in the environment to override.
TOKEN_DAILY_CAP_USD = float(os.environ.get("TOKEN_DAILY_CAP_USD", "10.0"))

_token_input   = 0
_token_output  = 0
_run_cost_usd  = 0.0
_token_lock    = threading.Lock()
_cap_hit       = threading.Event()

COMPANY_NAME = os.environ.get("COMPANY_NAME", "").strip()

# OEM name pattern — dealer strings that match the OEM itself are rejected.
# Derived from COMPANY_NAME; extend with abbreviations as needed for your company.
_oem_name = COMPANY_NAME or None
OEM_PATTERN = re.compile(r"\b" + re.escape(_oem_name) + r"\b", re.IGNORECASE) if _oem_name else None

_company_label = COMPANY_NAME or "the respondent company"

_GARBAGE_PHRASES = re.compile(
    r"represented by|authorised dealer|authorized dealer|"
    r"\bservice cent(?:re|er)\b|its dealer|"
    r"&\s*anr\.?|&\s*ors\.?|\bors\.?\b|\banr\.?\b",
    re.IGNORECASE,
)
_EDGE_CONJUNCTION = re.compile(
    r"^(and|or|of|the|its|by|&)\b|\b(and|or|of|the|its|by|&)$",
    re.IGNORECASE,
)

SYSTEM_INSTRUCTION = f"""You are extracting dealership names from Indian consumer-court case respondent entries involving {_company_label}.

Given a respondent string, identify and return ONLY the dealership/dealer/service-centre name — NOT the OEM itself. Normalise: remove legal suffixes (Pvt, Ltd, Private, Limited, Co., M/s, &, Ors, ANR) and extra whitespace. If no dealer can be identified, return null.

Return ONLY a JSON object: {{"dealership_canonical": "Dealer Name" or null}}

EXAMPLES:
Input: "ExampleCo Ltd, Concorde Motors, Pune" → {{"dealership_canonical": "Concorde Motors"}}
Input: "EXAMPLECO LIMITED & ANR" → {{"dealership_canonical": null}}
Input: "Popular Vehicles And Services Ltd, Kochi & ExampleCo" → {{"dealership_canonical": "Popular Vehicles And Services"}}
Input: "Nexus Auto Pvt Ltd" → {{"dealership_canonical": "Nexus Auto"}}
Input: "ExampleCo & Its Authorised Dealer" → {{"dealership_canonical": null}}

Return ONLY the JSON. No markdown. No explanation."""


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
# Schema migration (no-op — schema managed by PostgreSQL DDL)
# ------------------------------------------------------------------

def migrate(con) -> None:
    pass  # dealership_canonical column is in the PostgreSQL schema from the start


# ------------------------------------------------------------------
# Extraction
# ------------------------------------------------------------------

def extract_dealer(respondent: str) -> Optional[str]:
    """Call the LLM to extract a normalised dealer name from a respondent string."""
    for attempt in range(1, RETRY_ATTEMPTS + 1):
        try:
            raw, in_tok, out_tok, _label, model_used = llm.call_llm(
                SYSTEM_INSTRUCTION,
                respondent,
                temperature=0.0,
                thinking_budget=0,
                # Use the default retry_attempts (3) per provider so transient
                # failures are retried before the fallback is triggered.
            )
            _add_tokens(model_used, in_tok, out_tok)
            raw = raw.strip()
            raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.IGNORECASE)
            raw = re.sub(r"\s*```$", "", raw).strip()
            data   = json.loads(raw)
            dealer = data.get("dealership_canonical")
            if dealer and isinstance(dealer, str):
                dealer = dealer.strip()
                if ((OEM_PATTERN is None or not OEM_PATTERN.search(dealer))
                        and not _GARBAGE_PHRASES.search(dealer)
                        and not _EDGE_CONJUNCTION.search(dealer)
                        and len(dealer) >= 5):
                    return dealer
            return None
        except llm.LLMError as e:
            print(f"    [error] all LLM providers failed (attempt {attempt}): {e}")
            return None
        except Exception as e:
            if attempt < RETRY_ATTEMPTS:
                time.sleep(RETRY_DELAY * attempt)
    return None


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


def run(sample: Optional[int], force: bool, concurrency: int) -> None:
    llm.check_config()

    global _token_input, _token_output, _run_cost_usd
    _token_input  = 0
    _token_output = 0
    _run_cost_usd = 0.0
    _cap_hit.clear()

    today_prior_spend = _get_today_spend_from_log()

    conn = pgdb.get_connection()
    migrate(conn)

    if force:
        cur = conn.cursor()
        cur.execute("SELECT case_number, respondent FROM cases WHERE respondent IS NOT NULL ORDER BY case_number")
    else:
        cur = conn.cursor()
        cur.execute("""
            SELECT case_number, respondent FROM cases
            WHERE respondent IS NOT NULL
              AND (dealership_canonical IS NULL OR dealership_canonical = '')
            ORDER BY case_number
        """)

    candidates = [(r["case_number"], r["respondent"]) for r in cur.fetchall()]
    if sample:
        candidates = candidates[:sample]

    total = len(candidates)
    done  = 0
    nulls = 0
    lock  = threading.Lock()

    llm.print_config()
    print(f"\n[extract_respondents] Cases: {total}"
          f"  |  Concurrency: {concurrency}"
          f"  |  Mode: {'--force ' if force else ''}{'--sample '+str(sample) if sample else 'full'}")
    print(f"[extract_respondents] Daily cap: ${TOKEN_DAILY_CAP_USD:.2f} USD"
          f"  |  Already spent today: ${today_prior_spend:.4f} USD"
          f"  |  Remaining: ${max(0.0, TOKEN_DAILY_CAP_USD - today_prior_spend):.4f} USD\n")

    def process(args: tuple) -> tuple[str, Optional[str]]:
        case_number, respondent = args
        if _cap_hit.is_set():
            return case_number, None   # skip LLM call; will be counted as null
        dealer = extract_dealer(respondent)
        return case_number, dealer

    completed = 0
    with ThreadPoolExecutor(max_workers=concurrency) as ex:
        futures = {ex.submit(process, c): c for c in candidates}
        for future in as_completed(futures):
            case_number, dealer = future.result()
            with lock:
                upd = conn.cursor()
                upd.execute(
                    "UPDATE cases SET dealership_canonical=%s WHERE case_number=%s",
                    (dealer, case_number))
                completed += 1
                if dealer:
                    done += 1
                else:
                    nulls += 1
                if completed <= 20 or completed % 100 == 0:
                    print(f"  [{completed}/{total}] {case_number}: {dealer or 'null'}")

                # Check daily cap after each case's tokens accumulate.
                if not _cap_hit.is_set() and (today_prior_spend + _current_run_cost()) >= TOKEN_DAILY_CAP_USD:
                    _cap_hit.set()
                    print(
                        f"\n[token_usage] *** Daily cap of ${TOKEN_DAILY_CAP_USD:.2f} USD reached"
                        f" — no further LLM calls will be made this run ***\n"
                    )

    conn.close()
    print(f"\n[extract_respondents] Done — {done} dealers extracted, {nulls} null")
    _log_token_usage("extract_respondents.py", done, today_prior_spend)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Dealership Respondent Extraction")
    parser.add_argument("--sample",      type=int, default=None)
    parser.add_argument("--force",       action="store_true")
    parser.add_argument("--concurrency", type=int, default=3)
    args = parser.parse_args()
    run(sample=args.sample, force=args.force, concurrency=args.concurrency)
