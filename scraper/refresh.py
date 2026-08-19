"""
refresh.py — incremental update + cron scheduler (default: Mon-Sat 06:00 IST).

Incremental logic
-----------------
  Deletes search_progress rows for the trailing REFRESH_LOOKBACK_YEARS years so
  the harvester re-fetches them, picking up any new cases filed since the last
  full run. Existing cases in the `cases` table are upserted — no duplicates.

Pipeline sequence (each run)
-----------------------------
  1. Scrape new / updated cases          (main.py)
  2. LLM-extract unprocessed judgments   (extract.py)
  3. Invalidate API server cache         (POST /api/cache/invalidate)

Usage
-----
  # Run a refresh right now and exit:
  python3 refresh.py --now

  # Start the scheduler (runs forever, suitable for a persistent workflow):
  python3 refresh.py

Scheduler env vars (all optional)
----------------------------------
  REFRESH_HOUR_IST      hour (0-23) to run at, IST                (default: 6)
  REFRESH_MINUTE_IST    minute (0-59) to run at, IST               (default: 0)
  REFRESH_DAYS          comma-separated weekdays to run on, Python's
                         datetime.weekday() convention (0=Mon..6=Sun)
                                                                     (default: "0,1,2,3,4,5" = Mon-Sat)
  REFRESH_LOOKBACK_YEARS  trailing years to re-scrape each run       (default: 2)
  EXTRACT_CONCURRENCY     parallel LLM calls during the extraction step (default: 5)
"""

import argparse, datetime, importlib, os, time

import main as scraper
import extract
import judgements as judg_harvester
import pgdb
import sync_to_prod

# Load the company module (default: company.py; override via COMPANY_MODULE env var)
_mod_name = os.environ.get("COMPANY_MODULE", "company")
company   = importlib.import_module(_mod_name)

IST            = datetime.timezone(datetime.timedelta(hours=5, minutes=30))
LOOKBACK_YEARS = int(os.environ.get("REFRESH_LOOKBACK_YEARS", "2"))
RUN_HOUR       = int(os.environ.get("REFRESH_HOUR_IST", "6"))
RUN_MINUTE     = int(os.environ.get("REFRESH_MINUTE_IST", "0"))
RUN_DAYS       = {int(d) for d in os.environ.get("REFRESH_DAYS", "0,1,2,3,4,5").split(",") if d.strip() != ""}
EXTRACT_CONCURRENCY = int(os.environ.get("EXTRACT_CONCURRENCY", "5"))


def _clear_recent_progress(year_from: int) -> int:
    """Remove search_progress cells for year >= year_from.  Returns deleted count."""
    conn = pgdb.get_connection()
    cur  = conn.cursor()
    cur.execute("DELETE FROM search_progress WHERE year >= %s", (year_from,))
    deleted = cur.rowcount
    conn.close()
    return deleted


def _clear_recent_judg_progress(year_from: int) -> int:
    """Remove judg_progress keys whose embedded year >= year_from.

    judg_progress keys have the form  commission_id:year:serch_type
    so we match on the middle segment.  Returns deleted count.
    """
    conn = pgdb.get_connection()
    cur  = conn.cursor()
    current_year = datetime.datetime.now(IST).year
    deleted = 0
    for year in range(year_from, current_year + 1):
        cur.execute(
            "DELETE FROM judg_progress WHERE key LIKE %s",
            (f"%:{year}:%",),
        )
        deleted += cur.rowcount
    conn.close()
    return deleted


def _run_extraction() -> None:
    """Call the LLM extraction pipeline for all unprocessed cases."""
    print(f"[{datetime.datetime.now(IST).strftime('%H:%M IST')}] "
          "Starting LLM extraction for unprocessed cases …")
    try:
        extract.run(
            sample=None,
            force=False,
            offset=0,
            limit=None,
            concurrency=EXTRACT_CONCURRENCY,
        )
        print(f"[{datetime.datetime.now(IST).strftime('%H:%M IST')}] "
              "LLM extraction complete.")
    except Exception as exc:
        print(f"[{datetime.datetime.now(IST).strftime('%H:%M IST')}] "
              f"[warn] LLM extraction raised an exception: {exc}")
        print("Continuing — new scrape data will still be served after cache invalidation.")


def _invalidate_api_cache() -> None:
    """POST to the API server's cache-invalidation endpoint (best-effort)."""
    api_base   = os.environ.get("API_BASE_URL", "").rstrip("/")
    cache_secret = os.environ.get("CACHE_SECRET", "")

    if not api_base or not cache_secret:
        print("[cache] API_BASE_URL / CACHE_SECRET not set — skipping cache invalidation.")
        return

    url = f"{api_base}/api/cache/invalidate"
    try:
        import requests as http
        resp = http.post(
            url,
            headers={"x-cache-secret": cache_secret},
            timeout=10,
        )
        if resp.status_code == 204:
            print(f"[cache] Cache invalidated ({url}).")
        else:
            print(f"[cache] Unexpected status {resp.status_code} from {url}.")
    except Exception as exc:
        print(f"[cache] Failed to ping {url}: {exc}")


def do_refresh():
    now          = datetime.datetime.now(IST)
    current_year = now.year
    year_from    = current_year - LOOKBACK_YEARS + 1

    print(f"\n[{now.strftime('%Y-%m-%d %H:%M IST')}] "
          f"Incremental refresh — years {year_from}–{current_year}")

    # Step 1: scrape
    deleted = _clear_recent_progress(year_from)
    print(f"Cleared {deleted} search_progress cells (years ≥ {year_from})")
    scraper.run(year_from=year_from, year_to=current_year)
    print(f"[{datetime.datetime.now(IST).strftime('%H:%M IST')}] Scrape complete.")

    # Step 1b: re-fetch full detail for every open case
    print(f"[{datetime.datetime.now(IST).strftime('%H:%M IST')}] "
          "Re-fetching open cases …")
    try:
        conn = pgdb.get_connection()
        total, stage_chg, new_rows = scraper.refresh_open_cases(conn)
        conn.close()
        print(f"[{datetime.datetime.now(IST).strftime('%H:%M IST')}] "
              f"Open-case refresh done: {total} re-fetched, "
              f"{stage_chg} stage changes, {new_rows} new proceeding rows.")
    except Exception as exc:
        print(f"[{datetime.datetime.now(IST).strftime('%H:%M IST')}] "
              f"[warn] refresh_open_cases raised: {exc}")
        print("Continuing — existing data will still be served.")

    # Step 1c: judgements harvest for the same lookback window
    judg_deleted = _clear_recent_judg_progress(year_from)
    print(f"Cleared {judg_deleted} judg_progress cells (years ≥ {year_from})")
    print(f"[{datetime.datetime.now(IST).strftime('%H:%M IST')}] "
          "Harvesting judgements (last 2 years) …")
    try:
        judg_harvester.run(year_from=year_from, year_to=current_year)
        print(f"[{datetime.datetime.now(IST).strftime('%H:%M IST')}] "
              "Judgements harvest complete.")
    except Exception as exc:
        print(f"[{datetime.datetime.now(IST).strftime('%H:%M IST')}] "
              f"[warn] judgements harvest raised: {exc}")
        print("Continuing — existing judgement data will still be served.")

    # Step 2: LLM extraction
    _run_extraction()

    # Step 3: sync updated data to production database BEFORE cache invalidation.
    # The API re-warms its cache immediately after invalidation, so the sync
    # must complete first or the cache will be populated from pre-sync data.
    sync_ok = False
    try:
        sync_to_prod.run()
        sync_ok = True
    except Exception as exc:
        print(f"[{datetime.datetime.now(IST).strftime('%H:%M IST')}] "
              f"[warn] sync_to_prod raised: {exc}")
        print("Skipping cache invalidation — production may lag by one cycle.")

    # Step 4: invalidate API cache only after a successful sync.
    if sync_ok:
        _invalidate_api_cache()
    else:
        print(f"[{datetime.datetime.now(IST).strftime('%H:%M IST')}] "
              "[warn] Cache invalidation skipped due to sync failure.")

    print(f"[{datetime.datetime.now(IST).strftime('%H:%M IST')}] Refresh complete.\n")


def _next_run_str(now: datetime.datetime) -> str:
    target = now.replace(hour=RUN_HOUR, minute=RUN_MINUTE, second=0, microsecond=0)
    if now >= target or now.weekday() not in RUN_DAYS:
        target += datetime.timedelta(days=1)
        while target.weekday() not in RUN_DAYS:
            target += datetime.timedelta(days=1)
    delta  = target - now
    h, rem = divmod(int(delta.total_seconds()), 3600)
    m      = rem // 60
    return f"{target.strftime('%a %Y-%m-%d ' + f'{RUN_HOUR:02d}:{RUN_MINUTE:02d}' + ' IST')} (in {h}h {m}m)"


def main():
    parser = argparse.ArgumentParser(description="e-Jagriti incremental refresh scheduler")
    parser.add_argument("--now", action="store_true",
                        help="Run a refresh immediately and exit")
    args = parser.parse_args()

    if args.now:
        do_refresh()
        return

    print(f"Scheduler started ({company.PARTY_NAME}).")
    print(f"Will refresh on weekdays {sorted(RUN_DAYS)} (0=Mon..6=Sun) at "
          f"{RUN_HOUR:02d}:{RUN_MINUTE:02d} IST (lookback: {LOOKBACK_YEARS} years).")
    print(f"Next run: {_next_run_str(datetime.datetime.now(IST))}\n")

    last_run_date = None

    while True:
        now   = datetime.datetime.now(IST)
        today = now.date()

        is_scheduled_day = now.weekday() in RUN_DAYS
        is_run_window     = now.hour == RUN_HOUR and RUN_MINUTE <= now.minute < RUN_MINUTE + 5

        if is_scheduled_day and is_run_window and last_run_date != today:
            do_refresh()
            last_run_date = today

        if now.hour == (RUN_HOUR - 1) % 24 and now.minute >= 50:
            time.sleep(10)
        else:
            time.sleep(60)


if __name__ == "__main__":
    main()
