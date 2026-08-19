#!/usr/bin/env python3
"""
e-Jagriti JUDGEMENTS harvester — disposal-date sweep.

Database: PostgreSQL (connection via DATABASE_URL).

Company-specific settings live in company.py.
Environment-variable overrides:
  PARTY_NAME / OPPOSITE_PARTY   override company name sent to the API
  YEAR_FROM / YEAR_TO           disposal-year window
  COMPANY_MODULE                python module name for company config (default: company)
"""

import html as ihtml
import importlib, json, os, re, time, random
import requests
import pgdb

# ---------------------------------------------------------------- COMPANY ----
_company = importlib.import_module(os.environ.get("COMPANY_MODULE", "company"))

PARTY    = os.environ.get("OPPOSITE_PARTY",
           os.environ.get("PARTY_NAME", _company.PARTY_NAME))
YEAR_FROM = int(os.environ.get("YEAR_FROM", str(_company.YEAR_FROM)))
YEAR_TO   = int(os.environ.get("YEAR_TO",   str(_company.YEAR_TO)))

# ---------------------------------------------------------------- CONFIG -----
PAGE_SIZE = 30
URL = ("https://e-jagriti.gov.in/services/case/caseFilingService/v2"
       "/getCaseDetailsBySearchType")
DATE_REQUEST_TYPE = 2   # disposal date
ORDER_TYPE        = 2   # final judgement

SERCH_RESPONDENT  = 3
SERCH_COMPLAINANT = 2

HEADERS = {
    "Accept": "application/json",
    "Content-Type": "application/json",
    "Origin": "https://e-jagriti.gov.in",
    "Referer": "https://e-jagriti.gov.in/",
    "User-Agent": "research-scraper/1.0 (public judgment analysis)",
}
MIN_DELAY, MAX_DELAY, MAX_RETRIES = 1.5, 3.0, 4

# --------------------------------------------------------------- STORAGE -----

def db_init(db_path=None):
    """Return a PostgreSQL connection.  db_path argument is ignored."""
    return pgdb.get_connection()


def is_done(con, key):
    cur = con.cursor()
    cur.execute("SELECT 1 FROM judg_progress WHERE key=%s", (key,))
    return cur.fetchone() is not None


def mark_done(con, key):
    cur = con.cursor()
    cur.execute(
        "INSERT INTO judg_progress (key) VALUES (%s) ON CONFLICT DO NOTHING",
        (key,))

# ------------------------------------------------------------------ HTTP -----

def polite():
    time.sleep(random.uniform(MIN_DELAY, MAX_DELAY))


def post(body):
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            r = requests.post(
                URL, headers=HEADERS, data=json.dumps(body), timeout=90
            )
            if r.status_code == 200:
                return r.json()
            print(f"    [warn] HTTP {r.status_code} ({attempt}/{MAX_RETRIES})")
        except (requests.RequestException, ValueError) as e:
            print(f"    [warn] {e} ({attempt}/{MAX_RETRIES})")
        time.sleep(2 ** attempt + random.random())
    return None

# ------------------------------------------------------- HTML -> TEXT --------

def clean_html(s):
    if not s:
        return ""
    s = re.sub(r"(?is)<(script|style).*?</\1>", "", s)
    s = re.sub(r"(?i)<br\s*/?>", "\n", s)
    s = re.sub(r"(?i)</(p|div|tr|li|table)>", "\n", s)
    s = re.sub(r"(?i)</td>", " ", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = ihtml.unescape(s).replace("\xa0", " ")
    s = re.sub(r"[ \t]{2,}", " ", s)
    return re.sub(r"\n\s*\n\s*\n+", "\n\n", s).strip()


def split_order_body(t):
    m = re.search(r"Final\s+Order\s*/\s*Judgement", t, re.I)
    return t[m.end():].strip() if m else t


def extract_bench(t):
    return list(dict.fromkeys(re.findall(
        r"HON'BLE\s+(?:MR|MRS|MS|DR)\.?\s+([A-Za-z.\s]+?)\s+"
        r"(?:PRESIDENT|MEMBER)", t
    )))

# ------------------------------------------------------------- HARVEST -------

def store(con, row, c, text_source=None):
    """Store a single judgement row.  Returns True if inserted/replaced."""
    cn = row.get("caseNumber")
    if not cn:
        return False
    raw  = row.get("judgmentOrderDocumentBase64") or ""
    text = clean_html(raw)
    cur  = con.cursor()
    cur.execute(
        """INSERT INTO judgements
           (case_number, commission_id, commission, level, state,
            complainant, respondent, comp_advocate, resp_advocate,
            filing_date, disposal_date, judgement_date,
            case_stage, filing_ref,
            co_respondents, co_complainants, bench,
            judgement_html, judgement_text, order_body,
            text_len, raw, text_source)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
           ON CONFLICT (case_number) DO UPDATE SET
               commission_id=EXCLUDED.commission_id,
               commission=EXCLUDED.commission,
               level=EXCLUDED.level,
               state=EXCLUDED.state,
               complainant=EXCLUDED.complainant,
               respondent=EXCLUDED.respondent,
               comp_advocate=EXCLUDED.comp_advocate,
               resp_advocate=EXCLUDED.resp_advocate,
               filing_date=EXCLUDED.filing_date,
               disposal_date=EXCLUDED.disposal_date,
               judgement_date=EXCLUDED.judgement_date,
               case_stage=EXCLUDED.case_stage,
               filing_ref=EXCLUDED.filing_ref,
               co_respondents=EXCLUDED.co_respondents,
               co_complainants=EXCLUDED.co_complainants,
               bench=EXCLUDED.bench,
               judgement_html=EXCLUDED.judgement_html,
               judgement_text=EXCLUDED.judgement_text,
               order_body=EXCLUDED.order_body,
               text_len=EXCLUDED.text_len,
               raw=EXCLUDED.raw,
               text_source=EXCLUDED.text_source""",
        (
            cn, c["id"], c["name"], c["level"], c["state"],
            row.get("complainantName"), row.get("respondentName"),
            row.get("complainantAdvocateName"), row.get("respondentAdvocateName"),
            row.get("caseFilingDate"), row.get("dateOfDisposal"),
            row.get("judgemtmentDate"),
            row.get("caseStageName"),
            str(row.get("filingReferenceNumber") or ""),
            json.dumps([
                d.get("additional_respondent_name")
                for d in (row.get("additionalRespondantList") or [])
            ]),
            json.dumps([
                d.get("additional_complainant_name")
                for d in (row.get("additionalComplainantList") or [])
            ]),
            json.dumps(extract_bench(text)),
            raw, text, split_order_body(text),
            len(text), json.dumps(row),
            text_source,
        ),
    )
    return True


def fetch_window(con, c, year, serch_type):
    """Fetch all pages for one (commission, year, serch_type). Returns rows stored."""
    stored, page = 0, 0
    side_label = "respondent" if serch_type == SERCH_RESPONDENT else "complainant"
    while True:
        body = {
            "commissionId": int(c["id"]),
            "page": page,
            "size": PAGE_SIZE,
            "fromDate": f"{year}-01-01",
            "toDate":   f"{year}-12-31",
            "dateRequestType": DATE_REQUEST_TYPE,
            "serchType":       serch_type,
            "serchTypeValue":  PARTY,
            "judgeId":         "",
            "orderType":       ORDER_TYPE,
        }
        payload = post(body)
        rows = (payload or {}).get("data") or []
        for r in rows:
            stored += store(con, r, c)
        if len(rows) < PAGE_SIZE:
            break
        page += 1
        polite()
    if stored:
        print(f"  {c['level']:8} {c['name']} [{c['state']}] {year} "
              f"({side_label}): {stored}")
    return stored


def run(year_from=None, year_to=None, db_path=None):
    """Sweep every commission × year × side combination for judgements.

    year_from / year_to — when passed they override the module-level defaults.
    db_path            — accepted but ignored (PostgreSQL is always used).
    """
    yf = year_from if year_from is not None else YEAR_FROM
    yt = year_to   if year_to   is not None else YEAR_TO

    con = db_init()

    cur = con.cursor()
    cur.execute("SELECT commission_id, level, name, state FROM commissions")
    comms = [
        {"id": r["commission_id"], "level": r["level"], "name": r["name"], "state": r["state"]}
        for r in cur.fetchall()
    ]
    if not comms:
        raise SystemExit(
            "No commissions table — run main.py first to build it."
        )

    years     = list(range(yf, yt + 1))
    sides     = [SERCH_RESPONDENT, SERCH_COMPLAINANT]
    total_windows = len(comms) * len(years) * len(sides)
    print(
        f"Party: '{PARTY}'  years {yf}–{yt}\n"
        f"{len(comms)} commissions × {len(years)} years × 2 sides "
        f"= {total_windows} windows\n"
    )

    total = 0
    for c in comms:
        for y in years:
            for st in sides:
                key = f"{c['id']}:{y}:{st}"
                if is_done(con, key):
                    continue
                n = fetch_window(con, c, y, st)
                total += n
                mark_done(con, key)
                polite()

    cnt = con.cursor()
    cnt.execute("SELECT COUNT(*) FROM judgements")
    n = cnt.fetchone()[0]
    cnt.execute("SELECT COUNT(*) FROM judgements WHERE text_len > 2000")
    big = cnt.fetchone()[0]
    print(
        f"\n{n} judgements stored ({total} this run); "
        f"{big} substantial (>2000 chars)."
    )
    print("Next: python3 reconcile.py --fill  then  python3 merge_judgements.py")


if __name__ == "__main__":
    run()
