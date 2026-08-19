#!/usr/bin/env python3
"""Flatten ejagriti.sqlite -> cases.csv and print a pending/disposed summary."""
import csv, sqlite3, collections

DB = "ejagriti.sqlite"
OUT = "cases.csv"

con = sqlite3.connect(DB)
con.row_factory = sqlite3.Row

# longest order_type=2 (final judgement) text per case
finals = {}
for row in con.execute("SELECT case_number, text_plain FROM proceedings WHERE order_type=2"):
    t = row["text_plain"] or ""
    if len(t) > len(finals.get(row["case_number"], "")):
        finals[row["case_number"]] = t

cases = list(con.execute("""SELECT case_number, commission, level, state, case_type,
                                   case_stage, category, complainant, respondent,
                                   comp_advocate, resp_advocate, filing_date, next_hearing
                            FROM cases ORDER BY state, commission, filing_date"""))

with open(OUT, "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["case_number","commission","level","state","case_type","case_stage",
                "category","complainant","respondent","comp_advocate","resp_advocate",
                "filing_date","next_hearing","final_judgement_text"])
    for c in cases:
        w.writerow([c[k] for k in c.keys()] + [finals.get(c["case_number"], "")])

def bucket(stage):
    s = (stage or "").upper()
    if "DISPOSED" in s or "DISMISS" in s or "ALLOWED" in s:
        return "disposed"
    return "pending"

by_state = collections.Counter()
overall  = collections.Counter()
for c in cases:
    b = bucket(c["case_stage"])
    overall[b] += 1
    by_state[(c["state"], b)] += 1

print(f"Wrote {len(cases)} cases to {OUT}  ({len(finals)} with final-judgement text)\n")
print(f"OVERALL:  pending={overall['pending']}  disposed={overall['disposed']}\n")
print(f"{'STATE':<22} {'PENDING':>8} {'DISPOSED':>9}")
states = sorted({s for (s, _) in by_state})
for st in states:
    print(f"{(st or '?'):<22} {by_state[(st,'pending')]:>8} {by_state[(st,'disposed')]:>9}")
