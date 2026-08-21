#!/usr/bin/env python3
"""
Multilingual extraction pilot — compares gemini-2.5-flash vs gemini-2.5-pro
on a mixed set of regional-language and English judgment texts.
"""
import json, os, re, time, sqlite3, datetime
import requests as http
from email.utils import parsedate_to_datetime

DB_PATH = "ejagriti.sqlite"
MODEL   = os.environ.get("EXTRACT_MODEL", "gemini-2.5-flash-lite")
# Use direct Google endpoint if GEMINI_API_KEY is set, otherwise use a proxy via GEMINI_BASE_URL.
_own_key = os.environ.get("GEMINI_API_KEY", "").strip()
if _own_key:
    base    = "https://generativelanguage.googleapis.com/v1beta"
    key     = _own_key
    # Google's native API uses x-goog-api-key only; Bearer causes 401
    headers = {"x-goog-api-key": key, "Content-Type": "application/json"}
else:
    base    = os.environ.get("GEMINI_BASE_URL", "").rstrip("/")
    key     = os.environ.get("GEMINI_API_KEY", "dummy")
    headers = {"x-goog-api-key": key, "Authorization": f"Bearer {key}",
               "Content-Type": "application/json"}
url = f"{base}/models/{MODEL}:generateContent"

CASES = [
    # regional-language (detected by non-ASCII density)
    "DC/497/CC/130/2019", "NC/RP/1228/2017", "DC/59/CC/67/2023",
    "DC/58/CC/336/2022", "DC/339/CC/40/2022", "DC/125/CC/119/2015",
    "NC/RP/1826/2015", "DC/389/CC/17/92", "DC/223/CC/65/2021", "SC/24/MA/1268/2023",
    # English
    "DC/AB2/525/CC/436/2025", "DC/151/CC/101/2024", "DC/312/CC/105/2022",
    "DC/578/CC/351/2024", "DC/296/CC/6/2018", "DC/296/MA/1/2016",
    "DC/573/CC/114/2024", "DC/560/CC/272/2025", "DC/37/CC/21/62",
    "DC/490/CC/260/2026",   # known Marathi
]
REGIONAL_SET = set(CASES[:10]) | {"DC/490/CC/260/2026"}

def _parse_retry_after(v, default):
    try:
        return max(1.0, float(v))
    except Exception:
        pass
    try:
        rt = parsedate_to_datetime(v)
        return max(1.0, (rt - datetime.datetime.now(datetime.timezone.utc)).total_seconds())
    except Exception:
        return default

# ── Load SYSTEM_INSTRUCTION from extract.py ──────────────────────────────────
import importlib.util, pathlib, sys
spec = importlib.util.spec_from_file_location("extract", pathlib.Path(__file__).parent / "extract.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
SYSTEM_INSTRUCTION = mod.SYSTEM_INSTRUCTION
# ─────────────────────────────────────────────────────────────────────────────

con = sqlite3.connect(DB_PATH)

# Fetch previous (flash) extractions for comparison
old = {}
for cn in CASES:
    row = con.execute(
        "SELECT extracted, extraction_status FROM cases WHERE case_number=?", (cn,)
    ).fetchone()
    if row and row[0]:
        d = json.loads(row[0])
        old[cn] = {
            "issue_type": d.get("issue_type"),
            "outcome":    d.get("outcome"),
            "conf":       d.get("confidence"),
            "status":     row[1],
        }

print(f"Model: {MODEL}  |  Cases: {len(CASES)}\n")
print("=== BEFORE (gemini-2.5-flash) ===")
for cn in CASES:
    o = old.get(cn, {})
    tag = "REG" if cn in REGIONAL_SET else "ENG"
    print(f"  [{tag}] {cn}: issue={o.get('issue_type')}  out={o.get('outcome')}  conf={o.get('conf')}")

print(f"\n=== NOW ({MODEL}) ===")

results = []
for i, cn in enumerate(CASES, 1):
    row = con.execute(
        "SELECT text_plain FROM proceedings WHERE case_number=? "
        "ORDER BY length(text_plain) DESC LIMIT 1", (cn,)
    ).fetchone()
    txt = (row[0] or "")[:6000] if row else ""
    if len(txt) < 50:
        print(f"  [{i:02d}] {cn}: SKIP (text={len(txt)} chars)")
        results.append((cn, None))
        continue

    non_ascii = sum(1 for c in txt if ord(c) > 127)
    tag = "REG" if cn in REGIONAL_SET else "ENG"

    body = {
        "systemInstruction": {"parts": [{"text": SYSTEM_INSTRUCTION}]},
        "contents": [{"role": "user", "parts": [{"text": f"JUDGMENT TEXT:\n\n{txt}"}]}],
        "generationConfig": {"response_mime_type": "application/json", "thinkingConfig": {"thinkingBudget": 0}},
    }

    extracted = None
    for attempt in range(1, 4):
        try:
            r = http.post(url, json=body, headers=headers, timeout=120)
            if r.status_code == 429:
                wait = _parse_retry_after(r.headers.get("retry-after", ""), 15 * attempt)
                print(f"  [{i:02d}] rate-limit → wait {wait:.0f}s")
                time.sleep(wait)
                continue
            r.raise_for_status()
            parts = r.json()["candidates"][0]["content"]["parts"]
            raw = next((p["text"] for p in parts if not p.get("thought")), parts[-1]["text"]).strip()
            raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.IGNORECASE)
            raw = re.sub(r"\s*```$", "", raw).strip()
            extracted = json.loads(raw)
            break
        except Exception as e:
            print(f"  [{i:02d}] attempt {attempt} error: {e}")
            if attempt < 3:
                time.sleep(5 * attempt)

    if extracted:
        conf = float(extracted.get("confidence") or 0)
        print(f"  [{i:02d}] [{tag}] {cn}: issue={extracted.get('issue_type')}  "
              f"out={extracted.get('outcome')}  conf={conf:.2f}")
        results.append((cn, extracted))
    else:
        print(f"  [{i:02d}] [{tag}] {cn}: FAILED")
        results.append((cn, None))

# ── Summary ──────────────────────────────────────────────────────────────────
good     = [(cn, d) for cn, d in results if d]
reg_new  = [(cn, d) for cn, d in good if cn in REGIONAL_SET]
eng_new  = [(cn, d) for cn, d in good if cn not in REGIONAL_SET]
reg_old  = [old.get(cn, {}) for cn in REGIONAL_SET if cn in old]
eng_old  = [old.get(cn, {}) for cn in set(CASES) - REGIONAL_SET if cn in old]

def fill_rate(lst, field):
    if not lst: return "n/a"
    return f"{sum(1 for _,d in lst if d.get(field) is not None)}/{len(lst)}"

def old_fill(lst, field):
    if not lst: return "n/a"
    return f"{sum(1 for d in lst if d.get(field) is not None)}/{len(lst)}"

def avg_conf(lst):
    vals = [float(d.get("confidence") or 0) for _, d in lst if d.get("confidence") is not None]
    return f"{sum(vals)/len(vals):.2f}" if vals else "n/a"

def old_conf(lst):
    vals = [float(d.get("conf") or 0) for d in lst if d.get("conf") is not None]
    return f"{sum(vals)/len(vals):.2f}" if vals else "n/a"

print("\n=== SUMMARY ===")
print(f"  {'field':<20}  {'OLD reg':>8}  {'NEW reg':>8}  {'OLD eng':>8}  {'NEW eng':>8}")
for f in ["issue_type", "sales_or_service", "outcome"]:
    print(f"  {f:<20}  {old_fill(reg_old,f):>8}  {fill_rate(reg_new,f):>8}"
          f"  {old_fill(eng_old,f):>8}  {fill_rate(eng_new,f):>8}")
print(f"  {'avg confidence':<20}  {old_conf(reg_old):>8}  {avg_conf(reg_new):>8}"
      f"  {old_conf(eng_old):>8}  {avg_conf(eng_new):>8}")
