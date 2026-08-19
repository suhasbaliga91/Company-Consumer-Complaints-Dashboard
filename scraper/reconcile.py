#!/usr/bin/env python3
"""
Reconcile known cases against harvested judgements — prove coverage, close gaps.

Database: PostgreSQL (connection via DATABASE_URL).

USAGE
    python3 reconcile.py               # audit only, no network
    python3 reconcile.py --fill        # audit + PASS 1/2/3 gap closing
    python3 reconcile.py --audit-only  # same as no flags (explicit)
"""

import collections, importlib, json, os, re, sys, time, random
import requests
import pgdb

# ---------------------------------------------------------------- COMPANY ----
_company  = importlib.import_module(os.environ.get("COMPANY_MODULE", "company"))
PARTY     = os.environ.get("OPPOSITE_PARTY",
            os.environ.get("PARTY_NAME", _company.PARTY_NAME))

# ---------------------------------------------------------------- CONFIG -----
URL = ("https://e-jagriti.gov.in/services/case/caseFilingService/v2"
       "/getCaseDetailsBySearchType")
PAGE_SIZE = 30
HEADERS   = {
    "Accept":       "application/json",
    "Content-Type": "application/json",
    "Origin":       "https://e-jagriti.gov.in",
    "Referer":      "https://e-jagriti.gov.in/",
    "User-Agent":   "research-scraper/1.0 (coverage reconciliation)",
}
SERCH_RESPONDENT  = 3
SERCH_COMPLAINANT = 2
DISPOSED_RE       = re.compile(r"DISPOSED|DISMISS|ALLOWED|WITHDRAW", re.I)

# ---------------------------------------------------------------- HELPERS ----

def norm(cn):
    return re.sub(r"[^A-Z0-9]", "", (cn or "").upper())


def polite():
    time.sleep(random.uniform(1.5, 3.0))

# ------------------------------------------------------------ DB HELPERS ------

def ensure_cols(con):
    """No-op — schema is managed via PostgreSQL DDL."""
    pass

# ------------------------------------------- derive truth from case status ----

def case_facts(row):
    """From a cases row -> (is_disposed, disposal_date, inline_judgement_text)."""
    stage    = row["case_stage"] or ""
    disposed = bool(DISPOSED_RE.search(stage))
    disposal_date, inline = None, ""
    try:
        d = json.loads(row["detail_json"] or "{}").get("data") or {}
    except Exception:
        d = {}
    for h in d.get("caseHearingDetails", []) or []:
        if DISPOSED_RE.search(h.get("caseStage") or ""):
            dt = h.get("dateOfHearing")
            if dt and (disposal_date is None or dt > disposal_date):
                disposal_date = dt
        if h.get("orderTypeId") == 2:
            t = h.get("proceedingText") or ""
            if len(t) > len(inline):
                inline = t
    return disposed, disposal_date, inline


def clean_html(s):
    import html as ih
    if not s:
        return ""
    s = re.sub(r"(?i)<br\s*/?>", "\n", s)
    s = re.sub(r"(?i)</(p|div|tr|li|table)>", "\n", s)
    s = re.sub(r"<[^>]+>", "", s)
    return re.sub(r"\n{3,}", "\n\n",
                  ih.unescape(s).replace("\xa0", " ")).strip()

# ------------------------------------------------------------------ AUDIT ----

def audit(con):
    cur = con.cursor()
    cur.execute("SELECT case_number FROM judgements")
    have = {norm(r["case_number"]) for r in cur.fetchall()}

    cur2 = con.cursor()
    cur2.execute("SELECT * FROM cases")
    rows = cur2.fetchall()

    buckets = collections.Counter()
    gaps    = []
    for r in rows:
        disposed, ddate, inline = case_facts(r)
        matched = norm(r["case_number"]) in have
        if matched:
            buckets["matched"] += 1
        elif not disposed:
            buckets["pending_no_judgement_expected"] += 1
        elif inline:
            buckets["gap_but_text_on_disk"] += 1
            gaps.append((r, ddate, inline))
        else:
            buckets["gap_missing"] += 1
            gaps.append((r, ddate, ""))
    return rows, buckets, gaps


def report(rows, b):
    n = len(rows)
    print(f"\n=== COVERAGE AUDIT — {n} known cases ===")
    for k in [
        "matched",
        "pending_no_judgement_expected",
        "gap_but_text_on_disk",
        "gap_missing",
    ]:
        v = b.get(k, 0)
        if n:
            print(f"  {k:38} {v:>6}  ({v / n * 100:5.1f}%)")
        else:
            print(f"  {k:38} {v:>6}")
    dec = (b.get("matched", 0) +
           b.get("gap_but_text_on_disk", 0) +
           b.get("gap_missing", 0))
    if dec:
        cov = b.get("matched", 0) / dec * 100
        print(
            f"\n  judgement coverage of DISPOSED cases: "
            f"{b.get('matched',0)}/{dec} = {cov:.1f}%"
        )

# -------------------------------------------------------------- HTTP ---------

def post(body):
    for attempt in range(1, 4):
        try:
            r = requests.post(
                URL, headers=HEADERS, data=json.dumps(body), timeout=90
            )
            if r.status_code == 200:
                return r.json()
        except (requests.RequestException, ValueError):
            pass
        time.sleep(2 ** attempt)
    return None


def query_window(commission_id, year, serch_type):
    out, page = [], 0
    while True:
        p = post({
            "commissionId":    int(commission_id),
            "page":            page,
            "size":            PAGE_SIZE,
            "fromDate":        f"{year}-01-01",
            "toDate":          f"{year}-12-31",
            "dateRequestType": 2,
            "serchType":       serch_type,
            "serchTypeValue":  PARTY,
            "judgeId":         "",
            "orderType":       2,
        })
        rows = (p or {}).get("data") or []
        out += rows
        if len(rows) < PAGE_SIZE:
            break
        page += 1
        polite()
    return out

# -------------------------------------------------------------- GAP FILL -----

def store_from_module(con, row, case_row, source):
    from judgements import store as jstore
    c = {
        "id":    case_row["commission_id"],
        "name":  case_row["commission"],
        "level": case_row["level"],
        "state": case_row["state"],
    }
    return jstore(con, row, c, text_source=source)


def fill(con, gaps):
    ensure_cols(con)
    filled_inline = filled_targeted = 0

    # ---- PASS 1: free — inline judgement text already in detail_json ----------
    for case_row, ddate, inline in gaps:
        if not inline:
            continue
        txt = clean_html(inline)
        cur = con.cursor()
        cur.execute(
            """INSERT INTO judgements
               (case_number, commission_id, commission, level, state,
                complainant, respondent, comp_advocate, resp_advocate,
                filing_date, disposal_date, judgement_date, case_stage,
                judgement_text, order_body, text_len, text_source)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
               ON CONFLICT DO NOTHING""",
            (
                case_row["case_number"],
                case_row["commission_id"], case_row["commission"],
                case_row["level"],        case_row["state"],
                case_row["complainant"],  case_row["respondent"],
                case_row["comp_advocate"], case_row["resp_advocate"],
                case_row["filing_date"],  ddate, ddate,
                case_row["case_stage"],
                txt, txt, len(txt),
                "case_status_inline",
            ),
        )
        filled_inline += 1
    print(f"\nPASS 1  filled {filled_inline} gaps from detail_json (no network)")

    # ---- PASS 2 + 3: targeted re-query for each still-missing disposed case ---
    cur2 = con.cursor()
    cur2.execute("SELECT case_number FROM judgements")
    have = {norm(r["case_number"]) for r in cur2.fetchall()}
    todo: dict = collections.defaultdict(list)
    for case_row, ddate, _ in gaps:
        if norm(case_row["case_number"]) in have:
            continue
        if not ddate:
            continue
        todo[(case_row["commission_id"], ddate[:4])].append(case_row)

    print(f"PASS 2/3  {len(todo)} targeted commission-year windows to re-query")

    for (cid, year), case_rows in todo.items():
        wanted = {norm(c["case_number"]): c for c in case_rows}
        for st in (SERCH_RESPONDENT, SERCH_COMPLAINANT):
            side = "respondent" if st == SERCH_RESPONDENT else "complainant"
            for row in query_window(cid, year, st):
                k = norm(row.get("caseNumber") or "")
                if k in wanted:
                    src = f"module_{side}_side"
                    filled_targeted += store_from_module(
                        con, row, wanted[k], src
                    )
            polite()

    print(f"         filled {filled_targeted} gaps via targeted queries")

    cur3 = con.cursor()
    cur3.execute("SELECT COUNT(*) FROM judgements")
    n = cur3.fetchone()[0]
    print(f"\njudgements table now holds {n} rows")
    cur3.execute(
        "SELECT COALESCE(text_source,'sweep'), COUNT(*) "
        "FROM judgements GROUP BY 1 ORDER BY 2 DESC"
    )
    for row in cur3.fetchall():
        print(f"   {row[0]:34} {row[1]}")

# ------------------------------------------------------------------- MAIN ----

def run(fill_gaps=False, db_path=None):
    con = pgdb.get_connection()
    rows, buckets, gaps = audit(con)
    report(rows, buckets)
    if fill_gaps:
        fill(con, gaps)
        rows, buckets, gaps = audit(con)
        print("\n=== AFTER FILLING ===")
        report(rows, buckets)
    else:
        print("\n(run with --fill to close the gaps)")
    con.close()


if __name__ == "__main__":
    fill_flag = "--fill" in sys.argv and "--audit-only" not in sys.argv
    run(fill_gaps=fill_flag)
