#!/usr/bin/env python3
"""
Join judgements onto cases by case_number -> cases_enriched.csv

Database: PostgreSQL (connection via DATABASE_URL).

Judgements arrive from a disposal-date sweep, so they include cases the
filing-date harvest never saw. Those are emitted too, flagged new_from_judgements=1.
"""

import csv, importlib, json, os, re
import pgdb

# ---------------------------------------------------------------- COMPANY ----
_company  = importlib.import_module(os.environ.get("COMPANY_MODULE", "company"))
OUT       = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                         "cases_enriched.csv")

# ---------------------------------------------------------------- HELPERS ----

def norm(cn):
    return re.sub(r"[^A-Z0-9]", "", (cn or "").upper())

# ---------------------------------------------------------------- MAIN -------

def run():
    con = pgdb.get_connection()

    # ---- load judgements index ----
    J = {}
    try:
        cur = con.cursor()
        cur.execute("SELECT * FROM judgements")
        J = {r["case_number"]: r for r in cur.fetchall()}
    except Exception as e:
        print(f"[warn] Could not load judgements: {e}\n"
              "Run  python3 judgements.py  first.\n"
              "Continuing — cases will be exported without judgement columns.")

    Jn = {norm(k): v for k, v in J.items()}

    # ---- load cases ----
    cases = []
    try:
        cur2 = con.cursor()
        cur2.execute("SELECT * FROM cases")
        cases = cur2.fetchall()
    except Exception as e:
        print(f"[warn] Could not load cases: {e}")

    # ---- derive base_cols dynamically from live schema ----
    SKIP = {"search_row", "detail_json"}
    if cases:
        base_cols = [k for k in cases[0].keys() if k not in SKIP]
    else:
        base_cols = [
            "case_number", "commission_id", "commission", "level", "state",
            "case_type", "case_stage", "category",
            "complainant", "respondent",
            "comp_advocate", "resp_advocate",
            "filing_date", "next_hearing", "fetched_at",
        ]

    JCOLS = [
        "disposal_date", "judgement_date", "judgement_text",
        "order_body", "co_respondents", "bench", "text_len",
    ]

    exact = fuzzy = 0
    seen  = set()

    with open(OUT, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(base_cols + JCOLS + ["new_from_judgements"])

        # ---- known cases ----
        for c in cases:
            cn = c["case_number"]
            seen.add(norm(cn))
            j = J.get(cn)
            if j:
                exact += 1
            else:
                j = Jn.get(norm(cn))
                if j:
                    fuzzy += 1

            def _c(k):
                try:
                    return c[k]
                except (KeyError, IndexError):
                    return ""

            def _j(k):
                if j is None:
                    return ""
                try:
                    return j[k]
                except (KeyError, IndexError):
                    return ""

            w.writerow([_c(k) for k in base_cols] +
                       [_j(k) for k in JCOLS] + [0])

        # ---- judgements with no matching case row ----
        extra = 0
        for k, j in J.items():
            if norm(k) in seen:
                continue
            extra += 1
            row_map = {
                "case_number":   k,
                "commission":    j["commission"],
                "commission_id": j["commission_id"],
                "level":         j["level"],
                "state":         j["state"],
                "case_stage":    j["case_stage"],
                "complainant":   j["complainant"],
                "respondent":    j["respondent"],
                "comp_advocate": j["comp_advocate"],
                "resp_advocate": j["resp_advocate"],
                "filing_date":   j["filing_date"],
            }
            w.writerow([row_map.get(col, "") for col in base_cols] +
                       [j[jc] if jc in j.keys() else "" for jc in JCOLS] + [1])

    con.close()
    total = len(cases)
    matched = exact + fuzzy
    pct = f"{matched / total * 100:.1f}%" if total else "n/a"
    print(
        f"{OUT}:\n"
        f"  {total} cases  |  matched {exact} exact + {fuzzy} normalised ({pct})\n"
        f"  {extra} judgements had no case row "
        f"(disposed outside your filing window) — emitted with new_from_judgements=1"
    )


if __name__ == "__main__":
    run()
