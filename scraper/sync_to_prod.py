#!/usr/bin/env python3
"""
sync_to_prod.py — Copy dev PostgreSQL tables to production.

Reads PROD_DATABASE_URL from the environment.
If the secret is absent the script exits cleanly so it is safe to call
unconditionally from refresh.py even during local-only dev runs.

Usage:
    python3 sync_to_prod.py                        # sync all dashboard tables
    python3 sync_to_prod.py --tables cases,judgements  # selective sync

Tables synced (in dependency order):
    commissions → cases → judgements

proceedings is NOT synced — the production API server does not query it,
and its 60 k+ rows would make every refresh slow.
"""

import argparse
import os
import sys
import time

import psycopg2
import psycopg2.extras

DEV_URL  = os.environ.get("DATABASE_URL")
PROD_URL = os.environ.get("PROD_DATABASE_URL")

# (table_name, [primary_key_columns], batch_size)
SYNC_TABLES = [
    ("commissions", ["commission_id"],               500),
    ("cases",       ["case_number"],                 200),
    ("judgements",  ["case_number"],                 100),
]

# Columns that are scraper-only (large JSON/HTML blobs) and not queried by
# the production API server.  Skipping them makes the sync ~10× faster.
SKIP_COLUMNS: dict[str, set[str]] = {
    "cases":      {"detail_json", "search_row"},
    "judgements": {"judgement_html", "judgement_text", "raw"},
}

# SQL expressions to use *in place of* the bare column name in the SELECT.
# Useful for truncating huge text fields the API only reads in small slices.
# Key = (table, column), value = SQL expression (must alias back to column name).
COLUMN_EXPR: dict[tuple[str, str], str] = {
    # The API reads substr(order_body, 1, 800); no need to ship the full text.
    ("judgements", "order_body"): "substr(order_body, 1, 2000) AS order_body",
}


def get_columns(cur, table: str) -> list[str]:
    """Return ordered column names for *table* from information_schema."""
    cur.execute(
        """
        SELECT column_name
        FROM   information_schema.columns
        WHERE  table_schema = 'public' AND table_name = %s
        ORDER  BY ordinal_position
        """,
        (table,),
    )
    return [r[0] for r in cur.fetchall()]


def sync_table(
    dev_conn,
    prod_conn,
    table: str,
    pk_cols: list[str],
    batch_size: int,
) -> int:
    dev_cur  = dev_conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
    prod_cur = prod_conn.cursor()

    all_cols     = get_columns(dev_cur, table)
    skip         = SKIP_COLUMNS.get(table, set())
    cols         = [c for c in all_cols if c not in skip]
    update_cols  = [c for c in cols if c not in pk_cols]
    col_list     = ", ".join(cols)
    placeholders = ", ".join(["%s"] * len(cols))
    conflict_clause = f"({', '.join(pk_cols)})"

    if update_cols:
        set_clause  = ", ".join(f"{c}=EXCLUDED.{c}" for c in update_cols)
        on_conflict = f"ON CONFLICT {conflict_clause} DO UPDATE SET {set_clause}"
    else:
        on_conflict = f"ON CONFLICT {conflict_clause} DO NOTHING"

    sql = f"INSERT INTO {table} ({col_list}) VALUES ({placeholders}) {on_conflict}"

    # Build the SELECT expression list, substituting COLUMN_EXPR overrides
    select_exprs = [
        COLUMN_EXPR.get((table, c), c) for c in cols
    ]
    select_list = ", ".join(select_exprs)

    dev_cur.execute(f"SELECT COUNT(*) FROM {table}")
    total = dev_cur.fetchone()[0]
    print(f"  {table}: {total} rows", end="", flush=True)

    dev_cur.execute(f"SELECT {select_list} FROM {table}")
    synced = 0
    while True:
        batch = dev_cur.fetchmany(batch_size)
        if not batch:
            break
        prod_cur.executemany(sql, [tuple(row[c] for c in cols) for row in batch])
        prod_conn.commit()
        synced += len(batch)

    print(f" → {synced} upserted")
    return synced


def run(tables: list[str] | None = None) -> None:
    if not PROD_URL:
        print("[sync_to_prod] PROD_DATABASE_URL not set — skipping production sync.")
        return

    t0 = time.time()
    print("[sync_to_prod] Starting dev → production sync …")

    dev_conn  = psycopg2.connect(DEV_URL)
    prod_conn = psycopg2.connect(PROD_URL)
    prod_conn.autocommit = False

    to_sync = [
        (t, pk, bs)
        for t, pk, bs in SYNC_TABLES
        if tables is None or t in tables
    ]

    total_rows = 0
    failed_tables: list[str] = []
    for table, pk_cols, batch_size in to_sync:
        try:
            n = sync_table(dev_conn, prod_conn, table, pk_cols, batch_size)
            total_rows += n
        except Exception as exc:
            print(f"\n[sync_to_prod] ERROR syncing {table}: {exc}")
            try:
                prod_conn.rollback()
            except Exception:
                pass
            failed_tables.append(table)

    dev_conn.close()
    prod_conn.close()

    elapsed = time.time() - t0
    if failed_tables:
        raise RuntimeError(
            f"[sync_to_prod] Sync FAILED for table(s): {failed_tables}. "
            f"Completed {total_rows} rows in {elapsed:.1f}s before failure. "
            "Cache invalidation will be skipped to avoid serving stale data."
        )

    print(f"[sync_to_prod] Done — {total_rows} rows synced in {elapsed:.1f}s\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Sync dev DB tables to production")
    parser.add_argument(
        "--tables",
        help="Comma-separated list of tables to sync (default: all)",
    )
    args = parser.parse_args()
    tables = [t.strip() for t in args.tables.split(",")] if args.tables else None
    run(tables=tables)
