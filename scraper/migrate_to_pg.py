#!/usr/bin/env python3
"""
migrate_to_pg.py — One-time data migration from SQLite to PostgreSQL.

Reads all rows from scraper/ejagriti.sqlite and inserts them into the
PostgreSQL database using ON CONFLICT DO NOTHING (idempotent — safe
to re-run if interrupted).

Usage (from repo root):
    python3 scraper/migrate_to_pg.py

Requirements:
  DATABASE_URL env var pointing to your PostgreSQL instance
  scraper/ejagriti.sqlite must exist and be readable
"""
import json, os, sqlite3, sys, time

SQLITE_PATH = os.environ.get(
    "DB_PATH",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "ejagriti.sqlite")
)
BATCH_SIZE = 50   # keep small — judgement rows can be several hundred KB each


def connect_sqlite():
    if not os.path.exists(SQLITE_PATH):
        sys.exit(f"[error] SQLite file not found: {SQLITE_PATH}")
    conn = sqlite3.connect(SQLITE_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def migrate_commissions(src, pg):
    print("Migrating commissions …")
    rows = src.execute("SELECT commission_id, level, name, state FROM commissions").fetchall()
    cur = pg.cursor()
    for r in rows:
        cur.execute(
            "INSERT INTO commissions (commission_id, level, name, state)"
            " VALUES (%s,%s,%s,%s) ON CONFLICT DO NOTHING",
            (r["commission_id"], r["level"], r["name"], r["state"]))
    print(f"  {len(rows)} rows processed.")


def migrate_cases(src, pg):
    print("Migrating cases …")
    # Read actual columns from SQLite (the schema has grown over time via ALTER TABLE)
    cols_info = src.execute("PRAGMA table_info(cases)").fetchall()
    sqlite_cols = {c[1] for c in cols_info}

    # PostgreSQL target columns (all present in the DDL schema)
    pg_cols = [
        "case_number","commission_id","commission","level","state",
        "case_type","case_stage","category","complainant","respondent",
        "comp_advocate","resp_advocate","filing_date","next_hearing",
        "search_row","detail_json","fetched_at",
        "extracted","extraction_status","extracted_at","dealership_canonical",
    ]

    cur = pg.cursor()
    rows = src.execute(f"SELECT * FROM cases").fetchall()
    n = 0
    for row in rows:
        vals = {col: (row[col] if col in sqlite_cols else None) for col in pg_cols}
        placeholders = ", ".join(["%s"] * len(pg_cols))
        cur.execute(
            f"INSERT INTO cases ({', '.join(pg_cols)}) VALUES ({placeholders})"
            " ON CONFLICT DO NOTHING",
            [vals[c] for c in pg_cols])
        n += 1
        if n % 500 == 0:
            print(f"  cases: {n}/{len(rows)} rows …")
    print(f"  {n} rows processed.")


def migrate_proceedings(src, pg):
    print("Migrating proceedings …")
    cur = pg.cursor()
    rows = src.execute(
        "SELECT case_number, seq, order_type, hearing_date, stage, text_plain FROM proceedings"
    ).fetchall()
    n = 0
    for r in rows:
        cur.execute(
            "INSERT INTO proceedings (case_number, seq, order_type, hearing_date, stage, text_plain)"
            " VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING",
            (r["case_number"], r["seq"] or 0, r["order_type"] or 0,
             r["hearing_date"], r["stage"], r["text_plain"]))
        n += 1
        if n % 5000 == 0:
            print(f"  proceedings: {n} rows …")
    print(f"  {n} rows processed.")


def migrate_search_progress(src, pg):
    print("Migrating search_progress …")
    cur = pg.cursor()
    rows = src.execute("SELECT commission_id, year FROM search_progress").fetchall()
    for r in rows:
        cur.execute(
            "INSERT INTO search_progress (commission_id, year) VALUES (%s,%s) ON CONFLICT DO NOTHING",
            (r["commission_id"], r["year"]))
    print(f"  {len(rows)} rows processed.")


def migrate_judgements(src, pg):
    print("Migrating judgements (batches of 50 — large HTML rows) …")
    tbl = src.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='judgements'"
    ).fetchone()
    if not tbl:
        print("  judgements table not found in SQLite — skipping.")
        return

    cur_count = src.execute("SELECT COUNT(*) FROM judgements").fetchone()[0]
    print(f"  {cur_count} rows to migrate …")

    pg_cur = pg.cursor()
    src_cur = src.execute("""
        SELECT case_number, commission_id, commission, level, state,
               complainant, respondent, comp_advocate, resp_advocate,
               filing_date, disposal_date, judgement_date,
               case_stage, filing_ref, co_respondents, co_complainants, bench,
               judgement_html, judgement_text, order_body,
               text_len, raw, text_source
        FROM judgements
    """)

    n = 0
    while True:
        batch = src_cur.fetchmany(BATCH_SIZE)
        if not batch:
            break
        for r in batch:
            pg_cur.execute(
                """INSERT INTO judgements
                   (case_number, commission_id, commission, level, state,
                    complainant, respondent, comp_advocate, resp_advocate,
                    filing_date, disposal_date, judgement_date,
                    case_stage, filing_ref, co_respondents, co_complainants, bench,
                    judgement_html, judgement_text, order_body,
                    text_len, raw, text_source)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT DO NOTHING""",
                (r["case_number"], r["commission_id"], r["commission"],
                 r["level"], r["state"],
                 r["complainant"], r["respondent"],
                 r["comp_advocate"], r["resp_advocate"],
                 r["filing_date"], r["disposal_date"], r["judgement_date"],
                 r["case_stage"], r["filing_ref"],
                 r["co_respondents"], r["co_complainants"], r["bench"],
                 r["judgement_html"], r["judgement_text"], r["order_body"],
                 r["text_len"], r["raw"], r["text_source"]))
            n += 1
        if n % 100 == 0 or n >= cur_count:
            pct = n / cur_count * 100 if cur_count else 0
            print(f"  judgements: {n}/{cur_count} ({pct:.0f}%) …")
    print(f"  {n} rows processed.")


def migrate_judg_progress(src, pg):
    print("Migrating judg_progress …")
    tbl = src.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='judg_progress'"
    ).fetchone()
    if not tbl:
        print("  judg_progress not found — skipping.")
        return
    cur = pg.cursor()
    rows = src.execute("SELECT key FROM judg_progress").fetchall()
    for r in rows:
        cur.execute(
            "INSERT INTO judg_progress (key) VALUES (%s) ON CONFLICT DO NOTHING",
            (r["key"],))
    print(f"  {len(rows)} rows processed.")


def main():
    import pgdb as pg_module

    print(f"[migrate] Source SQLite : {SQLITE_PATH}")
    print(f"[migrate] Target        : PostgreSQL (DATABASE_URL)")
    print()

    t0 = time.time()
    src = connect_sqlite()
    pg  = pg_module.get_connection()

    migrate_commissions(src, pg)
    migrate_cases(src, pg)
    migrate_proceedings(src, pg)
    migrate_search_progress(src, pg)
    migrate_judgements(src, pg)
    migrate_judg_progress(src, pg)

    src.close()
    pg.close()

    elapsed = time.time() - t0
    print(f"\n[migrate] Complete in {elapsed:.1f}s.")
    print("[migrate] Verify: python3 -c \"import pgdb; c=pgdb.get_connection(); cur=c.cursor();"
          " cur.execute('SELECT COUNT(*) FROM cases'); print(cur.fetchone()[0])\"")
    print("[migrate] You can now add scraper/*.sqlite to .gitignore to exclude the local SQLite files.")


if __name__ == "__main__":
    main()
