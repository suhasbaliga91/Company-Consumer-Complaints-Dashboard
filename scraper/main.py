#!/usr/bin/env python3
"""
e-Jagriti nationwide consumer-case harvester.

Pulls every consumer-commission case (District + State + National) naming a
company and stores the full order/judgement text, from the public e-Jagriti
JSON API.  No auth, no captcha — all plain GETs.

Company-specific settings (party name, exclusions, year defaults) live in
company.py.  Swap that file to target a different company.

Database: PostgreSQL (connection via DATABASE_URL).

Environment-variable overrides (all optional):
  OPPOSITE_PARTY       override the company name sent to the API
  RESPONDENT_ONLY      "1" respondent-only / "0" both sides
  YEAR_FROM / YEAR_TO  filing-year window
  RESTRICT_STATE_CODES ""=all, or "10" / "10,27" for a test run
  COMPANY_MODULE       python module name for company config (default: company)

Resumable: stop/restart freely — completed (commission, year) cells and
already-fetched case details are skipped automatically.
"""

import html, importlib, json, os, re, time, random, urllib.parse
import requests
import pgdb

# ---------------------------------------------------------------- COMPANY ----
_company = importlib.import_module(os.environ.get("COMPANY_MODULE", "company"))

OPPOSITE_PARTY  = os.environ.get("OPPOSITE_PARTY",  _company.PARTY_NAME)
RESPONDENT_ONLY = os.environ.get("RESPONDENT_ONLY",
                                  "1" if _company.RESPONDENT_ONLY else "0") == "1"
YEAR_FROM       = int(os.environ.get("YEAR_FROM", str(_company.YEAR_FROM)))
YEAR_TO         = int(os.environ.get("YEAR_TO",   str(_company.YEAR_TO)))

_rsc = os.environ.get("RESTRICT_STATE_CODES", "").strip()
RESTRICT_STATE_CODES = [int(x) for x in _rsc.split(",") if x.strip()] or None

# ---------------------------------------------------------------- INFRA ------

CAL_STATE_ID    = 11100000   # Bihar State Commission
CAL_DISTRICT_ID = 11100212   # Patna District Commission
NATIONAL_ID     = 11000000   # NCDRC
STATE_CODE_RANGE = range(1, 38)

BASE        = "https://e-jagriti.gov.in/services"
SEARCH_PATH = "/report/report/getCauseTitleListByCompany"
DETAIL_PATH = "/case/caseFilingService/v2/getCaseStatus"
DISTS_PATH  = "/report/report/getDistrictCommissionByCommissionId"
ADDR_PATH   = "/report/report/getCommissionAddress"

HEADERS = {"Accept": "application/json", "Referer": "https://e-jagriti.gov.in/",
           "User-Agent": "research-scraper/1.0 (public consumer-case analysis)"}
MIN_DELAY, MAX_DELAY = 1.5, 3.0
MAX_RETRIES = 4

# --------------------------------------------------------------- STORAGE -----

def db_init(db_path=None):
    """Return a PostgreSQL connection.  db_path is accepted but ignored (kept for
    call-site compatibility with refresh.py which passes it)."""
    return pgdb.get_connection()

# --------------------------------------------------------------- HTTP --------

def polite():
    time.sleep(random.uniform(MIN_DELAY, MAX_DELAY))

def get(url):
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            r = requests.get(url, headers=HEADERS, timeout=45)
            if r.status_code == 200:
                return r.json()
            print(f"    [warn] HTTP {r.status_code} ({attempt}/{MAX_RETRIES})")
        except (requests.RequestException, ValueError) as e:
            print(f"    [warn] {e} ({attempt}/{MAX_RETRIES})")
        time.sleep(2 ** attempt + random.random())
    print(f"    [skip] giving up: {url}")
    return None

def url_for(path, **params):
    return BASE + path + "?" + urllib.parse.urlencode(params)

def strip_html(s):
    if not s:
        return ""
    s = re.sub(r"(?is)<(script|style).*?</\1>", "", s)
    s = re.sub(r"(?i)<br\s*/?>", "\n", s)
    s = re.sub(r"(?i)</p>|</li>|</div>", "\n", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s)
    s = re.sub(r"[ \t]+\n", "\n", s)
    return re.sub(r"\n{3,}", "\n\n", s).strip()

# ------------------------------------------------------- DISCOVERY -----------

def get_districts(state_id):
    d = get(url_for(DISTS_PATH, commissionId=state_id))
    return (d or {}).get("data") or []

def get_address(commission_id):
    d = get(url_for(ADDR_PATH, commissionId=commission_id))
    rows = (d or {}).get("data") or []
    return rows[0] if rows else {}

def build_commission_list(con):
    cur = con.cursor()
    cur.execute("SELECT COUNT(*) FROM commissions")
    if cur.fetchone()[0]:
        print("commission list already built; reusing.")
        return
    print("Building commission list ...")
    cur.execute(
        "INSERT INTO commissions (commission_id, level, name, state) VALUES (%s,%s,%s,%s)"
        " ON CONFLICT DO NOTHING",
        (str(NATIONAL_ID), "national", "NCDRC", "INDIA"))
    for ss in (RESTRICT_STATE_CODES or list(STATE_CODE_RANGE)):
        state_id = int(f"11{ss:02d}0000")
        districts = get_districts(state_id)
        if not districts:
            continue
        addr = get_address(state_id)
        state_name = addr.get("state_name_en") or f"STATE-{ss:02d}"
        cur.execute(
            "INSERT INTO commissions (commission_id, level, name, state) VALUES (%s,%s,%s,%s)"
            " ON CONFLICT DO NOTHING",
            (str(state_id), "state",
             addr.get("commission_name_en") or f"{state_name} State Commission",
             state_name))
        for d in districts:
            cur.execute(
                "INSERT INTO commissions (commission_id, level, name, state) VALUES (%s,%s,%s,%s)"
                " ON CONFLICT DO NOTHING",
                (str(d["commissionId"]), "district",
                 d.get("commissionNameEn"), state_name))
        print(f"  state {ss:02d} {state_name}: {len(districts)} districts")
        polite()
    cur.execute("SELECT COUNT(*) FROM commissions")
    n = cur.fetchone()[0]
    print(f"commission list built: {n} commissions.\n")

def full_range_has_rows(commission_id, type_id, year_from, year_to):
    url = url_for(SEARCH_PATH, commissionTypeId=type_id, commissionId=commission_id,
                  filingDate1=f"{year_from}-01-01", filingDate2=f"{year_to}-12-31",
                  complainant_respondent_name_en=OPPOSITE_PARTY)
    data = get(url)
    rows = data if isinstance(data, list) else (data or {}).get("data") or []
    return len(rows) > 0

def detect_type_id(level, cal_id, candidates, fallback, year_from, year_to):
    for t in candidates:
        if full_range_has_rows(cal_id, t, year_from, year_to):
            print(f"  {level}: commissionTypeId = {t} (confirmed)")
            return t
        polite()
    print(f"  {level}: could not confirm; defaulting to {fallback}")
    return fallback

# ---------------------------------------------------------- HARVEST ----------

def search(commission_id, type_id, year):
    url = url_for(SEARCH_PATH, commissionTypeId=type_id, commissionId=commission_id,
                  filingDate1=f"{year}-01-01", filingDate2=f"{year}-12-31",
                  complainant_respondent_name_en=OPPOSITE_PARTY)
    data = get(url)
    return data if isinstance(data, list) else (data or {}).get("data") or []

def store_proceedings(con, cn, detail):
    data = (detail or {}).get("data") or {}
    seen = set()
    cur = con.cursor()
    for h in data.get("caseHearingDetails", []):
        # order_type is part of the PK — use 0 as sentinel when API returns null
        key = (h.get("hearingSequenceNumber") or 0, h.get("orderTypeId") or 0)
        if key in seen:
            continue
        seen.add(key)
        cur.execute(
            """INSERT INTO proceedings (case_number, seq, order_type, hearing_date, stage, text_plain)
               VALUES (%s,%s,%s,%s,%s,%s)
               ON CONFLICT (case_number, seq, order_type) DO UPDATE SET
                   hearing_date=EXCLUDED.hearing_date,
                   stage=EXCLUDED.stage,
                   text_plain=EXCLUDED.text_plain""",
            (cn, key[0], key[1], h.get("dateOfHearing"),
             h.get("caseStage"), strip_html(h.get("proceedingText"))))

# ----------------------------------------------------------------- RUN -------

def run(year_from=None, year_to=None):
    """Run a full (or partial) harvest.

    year_from / year_to — when passed (e.g. by refresh.py for incremental runs)
    they override the module-level YEAR_FROM / YEAR_TO.
    """
    yf = year_from if year_from is not None else YEAR_FROM
    yt = year_to   if year_to   is not None else YEAR_TO

    print(f"Target: '{OPPOSITE_PARTY}'  years {yf}-{yt}  "
          f"respondent_only={RESPONDENT_ONLY}  "
          f"states={RESTRICT_STATE_CODES or 'ALL'}\n")

    con = db_init()
    build_commission_list(con)

    print("Detecting commissionTypeId per level ...")
    type_id = {
        "national": 1,
        "state":    detect_type_id("state",    CAL_STATE_ID,    [2, 1, 3], 2, yf, yt),
        "district": detect_type_id("district", CAL_DISTRICT_ID, [3, 2, 1], 3, yf, yt),
    }
    print()

    cur = con.cursor()
    cur.execute(
        "SELECT commission_id, level, name, state FROM commissions "
        "ORDER BY CASE level WHEN 'national' THEN 0 WHEN 'state' THEN 1 ELSE 2 END"
    )
    commissions = cur.fetchall()

    for comm_row in commissions:
        cid   = comm_row["commission_id"]
        level = comm_row["level"]
        name  = comm_row["name"]
        state = comm_row["state"]
        for year in range(yf, yt + 1):
            chk = con.cursor()
            chk.execute("SELECT 1 FROM search_progress WHERE commission_id=%s AND year=%s",
                        (cid, year))
            if chk.fetchone():
                continue
            rows = search(cid, type_id[level], year)
            rows = [r for r in rows if _company.is_relevant(r, RESPONDENT_ONLY)]
            if rows:
                print(f"{level:8} {name} [{state}] {year}: {len(rows)} rows")
            for r in rows:
                cn = r.get("case_number")
                if not cn:
                    continue
                ups = con.cursor()
                ups.execute("""INSERT INTO cases
                    (case_number,commission_id,commission,level,state,case_type,
                     case_stage,category,complainant,respondent,comp_advocate,
                     resp_advocate,filing_date,next_hearing,search_row)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    ON CONFLICT(case_number) DO UPDATE SET
                        case_type=EXCLUDED.case_type,
                        case_stage=EXCLUDED.case_stage,
                        complainant=EXCLUDED.complainant,
                        respondent=EXCLUDED.respondent,
                        comp_advocate=EXCLUDED.comp_advocate,
                        resp_advocate=EXCLUDED.resp_advocate,
                        next_hearing=EXCLUDED.next_hearing,
                        search_row=EXCLUDED.search_row""",
                    (cn, cid, name, level, state, r.get("case_type_name"),
                     r.get("case_stage_name"), r.get("case_category_name"),
                     r.get("complainant_name"), r.get("respondent_name"),
                     r.get("complainant_advocate_name"),
                     r.get("respondent_advocate_name"),
                     r.get("case_filing_date"), r.get("date_of_next_hearing"),
                     json.dumps(r)))
                det = con.cursor()
                det.execute(
                    "SELECT detail_json IS NOT NULL FROM cases WHERE case_number=%s",
                    (cn,))
                already = det.fetchone()
                if not (already and already[0]):
                    d = get(url_for(DETAIL_PATH, caseNumber=cn))
                    if d is not None:
                        upd = con.cursor()
                        upd.execute("UPDATE cases SET detail_json=%s, case_stage=%s, "
                                    "fetched_at=%s WHERE case_number=%s",
                                    (json.dumps(d),
                                     (d.get("data") or {}).get("caseStage"),
                                     time.time(), cn))
                        store_proceedings(con, cn, d)
                    polite()
            sp = con.cursor()
            sp.execute(
                "INSERT INTO search_progress (commission_id, year) VALUES (%s,%s)"
                " ON CONFLICT DO NOTHING",
                (cid, year))

    stat = con.cursor()
    stat.execute("SELECT COUNT(*) FROM cases")
    n_cases = stat.fetchone()[0]
    stat.execute("SELECT COUNT(*) FROM proceedings WHERE order_type=2")
    n_final = stat.fetchone()[0]
    stat.execute("SELECT COUNT(*) FROM cases WHERE case_stage NOT LIKE '%DISPOSED%' "
                 "AND case_stage NOT LIKE '%DISMISS%'")
    pend = stat.fetchone()[0]
    print(f"\nDone. {n_cases} cases ({pend} not-yet-disposed), "
          f"{n_final} final judgements.")
    print("Run  python3 export.py  to get cases.csv + a pending/disposed summary.")


def refresh_open_cases(con):
    """Re-fetch detail_json and proceedings for every open case (no final judgment yet).

    Returns (total_refreshed, stage_changes, new_proc_rows).
    """
    cur = con.cursor()
    cur.execute("""
        SELECT c.case_number, c.case_stage
        FROM   cases c
        WHERE  c.detail_json IS NOT NULL
          AND  NOT EXISTS (
                SELECT 1 FROM proceedings p
                WHERE  p.case_number = c.case_number
                  AND  p.order_type  = 2
                )
        ORDER BY c.fetched_at ASC NULLS FIRST
    """)
    open_cases = cur.fetchall()

    total     = len(open_cases)
    stage_chg = 0
    new_rows  = 0

    print(f"[refresh_open_cases] {total} open cases to re-fetch …")

    for idx, row in enumerate(open_cases, 1):
        cn        = row["case_number"]
        old_stage = row["case_stage"]
        try:
            d = get(url_for(DETAIL_PATH, caseNumber=cn))
        except Exception as exc:
            print(f"  [warn] {cn}: exception during detail fetch: {exc} — skipping")
            d = None

        if d is None:
            upd = con.cursor()
            upd.execute("UPDATE cases SET fetched_at=%s WHERE case_number=%s",
                        (time.time(), cn))
            polite()
            continue

        new_stage = (d.get("data") or {}).get("caseStage")
        next_hrg  = (d.get("data") or {}).get("nextHearingDate")

        cnt = con.cursor()
        cnt.execute("SELECT COUNT(*) FROM proceedings WHERE case_number=%s", (cn,))
        before = cnt.fetchone()[0]

        upd = con.cursor()
        upd.execute(
            "UPDATE cases SET detail_json=%s, case_stage=%s, next_hearing=%s, "
            "fetched_at=%s WHERE case_number=%s",
            (json.dumps(d), new_stage, next_hrg, time.time(), cn),
        )
        store_proceedings(con, cn, d)

        cnt2 = con.cursor()
        cnt2.execute("SELECT COUNT(*) FROM proceedings WHERE case_number=%s", (cn,))
        after = cnt2.fetchone()[0]

        if new_stage and new_stage != old_stage:
            stage_chg += 1
        new_rows += max(0, after - before)

        if idx % 100 == 0:
            print(f"  … {idx}/{total} re-fetched "
                  f"({stage_chg} stage changes, {new_rows} new proceeding rows so far)")

        polite()

    print(f"[refresh_open_cases] Done. "
          f"total={total}, stage_changes={stage_chg}, new_proc_rows={new_rows}")
    return total, stage_chg, new_rows


if __name__ == "__main__":
    run()
