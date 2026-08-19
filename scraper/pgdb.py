"""
pgdb.py — Shared PostgreSQL connection helper for all scraper scripts.

Reads DATABASE_URL from the environment.  All scripts import from here instead
of using sqlite3 directly so the connection string is centralised.

Usage:
    import pgdb
    conn = pgdb.get_connection()         # new connection (caller closes)
    conn = pgdb.get_thread_connection()  # thread-local connection (reused per thread)
"""

import os
import threading

import psycopg2
import psycopg2.extras

DATABASE_URL = os.environ.get("DATABASE_URL")

if not DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL environment variable is not set. "
        "Set DATABASE_URL to your PostgreSQL connection string."
    )

_thread_local = threading.local()


def get_connection():
    """Return a new psycopg2 connection with autocommit=True.

    Uses DictCursor as the default cursor factory so rows support both
    index (row[0]) and name (row["col"]) access, matching sqlite3.Row behaviour.

    Caller is responsible for closing the connection.
    """
    conn = psycopg2.connect(
        DATABASE_URL,
        cursor_factory=psycopg2.extras.DictCursor,
    )
    conn.autocommit = True
    return conn


def get_thread_connection():
    """Return a per-thread psycopg2 connection (reused across calls within a thread).

    Safe to use from ThreadPoolExecutor workers — each thread gets its own
    connection so there is no cross-thread contention.  The connection is
    created on the first call from a thread; subsequent calls reuse it.
    """
    if not hasattr(_thread_local, "conn") or _thread_local.conn.closed:
        _thread_local.conn = get_connection()
    return _thread_local.conn
