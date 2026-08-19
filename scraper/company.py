"""
company.py — company-specific configuration for e-Jagriti scraping.

To target a different company, duplicate this file (e.g. company_acme.py),
edit the constants below, then either:
  - replace this file, or
  - set the COMPANY_MODULE env var to your new module name (without .py).

Everything in main.py and refresh.py is generic; only this file changes
between companies.

The OPPOSITE_PARTY env var overrides PARTY_NAME without touching this file.
"""

import os

# ---------------------------------------------------------------------------
# Identity
# ---------------------------------------------------------------------------

PARTY_NAME = os.environ.get("OPPOSITE_PARTY", "YOUR COMPANY")  # search term sent to the API
DB_PATH    = "ejagriti.sqlite"                                   # SQLite output file
YEAR_FROM  = 2015                # default start year (override via YEAR_FROM env var)
YEAR_TO    = 2026                # default end year   (override via YEAR_TO env var)

# ---------------------------------------------------------------------------
# Side filter
# ---------------------------------------------------------------------------

# False → keep cases where company appears as complainant OR respondent
# True  → keep only cases where company is the respondent
RESPONDENT_ONLY = False

# ---------------------------------------------------------------------------
# Exclusion rules
# ---------------------------------------------------------------------------
# Substrings (uppercase) that identify a DIFFERENT legal entity whose name
# happens to contain PARTY_NAME tokens.  A match on ANY term causes the
# row to be silently dropped even if PARTY_NAME tokens are present.
#
# Example: add "FINANCE" to exclude a finance-company subsidiary whose name
# contains the parent brand but is a separate legal entity.
EXCLUDE_TERMS: list[str] = [
    # "FINANCE",  # uncomment / extend as needed for your company
]

# ---------------------------------------------------------------------------
# Filter (imported directly by main.py — do not rename is_relevant)
# ---------------------------------------------------------------------------

def _tokens():
    return PARTY_NAME.upper().split()

def _matches(name):
    n = (name or "").upper()
    return all(tok in n for tok in _tokens())

def _excluded(name):
    n = (name or "").upper()
    return any(term in n for term in EXCLUDE_TERMS)

def is_relevant(row, respondent_only=None):
    """Return True if this case should be kept for this company.

    respondent_only — if passed, overrides the module-level RESPONDENT_ONLY
    (main.py uses this to honour the RESPONDENT_ONLY env var).
    """
    ro = RESPONDENT_ONLY if respondent_only is None else respondent_only
    comp = row.get("complainant_name") or ""
    resp = row.get("respondent_name") or ""
    comp_ok = _matches(comp) and not _excluded(comp)
    resp_ok = _matches(resp) and not _excluded(resp)
    return resp_ok if ro else (comp_ok or resp_ok)
