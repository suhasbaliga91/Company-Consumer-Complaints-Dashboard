# e-Jagriti consumer-case harvester

Downloads consumer-commission cases (District + State + National / NCDRC) that
name a company, **including the full order/judgement text**, from the public
e-Jagriti API (no login, no captcha). Public court records; be respectful — the
built-in delays and resumability are there on purpose.

## Quickstart

```bash
# Install dependencies
pip install -r requirements.txt

# Set your LLM credentials (Gemini recommended; see LLM Configuration below)
export GEMINI_API_KEY=your-google-ai-key

# Set the company to monitor
export OPPOSITE_PARTY="ACME MOTORS"
export COMPANY_NAME="Acme Motors"

# Test run — one state only (fast)
RESTRICT_STATE_CODES=10 python3 main.py   # 10 = Bihar

# Inspect results
python3 export.py   # writes cases.csv and prints a summary

# Full national run (resumes automatically if interrupted)
python3 main.py
```

## Scope knobs (shell env vars)
- `OPPOSITE_PARTY`  — search term used to query the registry (e.g. `ACME MOTORS`). Also used as the default for `COMPANY_NAME` when that is not set separately.
- `COMPANY_NAME`  — human-readable company name injected into the LLM extraction prompt (e.g. `Acme Motors`). Set this to match your target company so the model knows whose cases it is analysing.
- `RESPONDENT_ONLY` `1` = only cases filed against them (default) / `0` = either side
- `YEAR_FROM` / `YEAR_TO`  (default `2016` / `2026`)
- `RESTRICT_STATE_CODES`  blank = all India; `10` = Bihar; `10,27` = Bihar+Maharashtra

## Pipeline sync env vars (`refresh.py` + API server)

These vars wire the scraper → LLM extraction → API cache pipeline together so
the dashboard shows fresh data after each morning run.

### `refresh.py` (scraper side)
| Variable | Default | Purpose |
|---|---|---|
| `API_BASE_URL` | _(none)_ | Base URL of the API server, e.g. `https://your-api-server.example.com`. If unset, cache invalidation is skipped. |
| `CACHE_SECRET` | _(none)_ | Shared secret sent in the `x-cache-secret` header when pinging `/api/cache/invalidate`. Must match the API server's `CACHE_SECRET`. If unset, cache invalidation is skipped. |

### API server side
| Variable | Default | Purpose |
|---|---|---|
| `CACHE_SECRET` | _(none)_ | Required on the API server to authorise `POST /api/cache/invalidate`. Requests with a missing or wrong header get a `401`. |
| `CACHE_TTL_MS` | `43200000` (12 h) | Safety-net TTL in milliseconds. The cache auto-refreshes on the next request if the pipeline's invalidation ping is ever missed. |

## Judgements pipeline

The judgements pipeline harvests the **full HTML judgement text** for every
disposed case via the e-Jagriti disposal-date endpoint, then merges it onto the
existing `cases` table and audits coverage gaps.

### Run order (full historical sweep)

```bash
# 1. Build the commissions table and harvest case metadata (if not already done)
python3 main.py

# 2. Sweep every commission × year × side for judgement HTML (2015 – present)
#    Resumable — safe to re-run; completed windows are skipped automatically.
python3 judgements.py

# 3. Audit coverage and close gaps
#    --fill: closes gaps in three passes (inline text, targeted re-queries,
#            opposite-side queries). Omit for a report-only dry run.
python3 reconcile.py --fill

# 4. Produce cases_enriched.csv (cases + judgement columns merged)
python3 merge_judgements.py

# 5. LLM extraction pass (reads judgement_text already extracted above)
python3 extract.py
```

### What each script produces

| Script | Output |
|---|---|
| `judgements.py` | `judgements` table in `ejagriti.sqlite` — one row per case with raw HTML + cleaned text |
| `reconcile.py` | Coverage audit report; with `--fill` closes gaps via inline text and targeted re-queries |
| `merge_judgements.py` | `cases_enriched.csv` — every case row plus `disposal_date`, `judgement_text`, `bench`, etc.; rows with `new_from_judgements=1` are cases seen only via the disposal sweep |

### Incremental updates

`refresh.py` automatically calls `judgements.py` scoped to the last two calendar
years as part of its daily pipeline (after the main case harvest, before LLM
extraction). No manual intervention needed for day-to-day freshness.

### Scope knobs

Same env vars as `main.py` are honoured:
- `YEAR_FROM` / `YEAR_TO` — disposal-year window (default from `company.py`)
- `DB_PATH` — override the SQLite file path
- `OPPOSITE_PARTY` / `PARTY_NAME` — company name sent to the API
- `COMPANY_MODULE` — swap `company.py` for a different target company

## LLM Configuration

The extraction pipeline (`extract.py`, `extract_respondents.py`) calls an LLM to
classify judgment text.  All provider and model settings are controlled via
environment variables; no code changes are needed to switch providers.

### Core variables

| Variable | Default | Purpose |
|---|---|---|
| `LLM_PRIMARY_PROVIDER` | auto-detect | `gemini` or `openai` — which provider to use first |
| `LLM_PRIMARY_MODEL` | `gemini-2.5-flash-lite` | Model name for the primary provider |
| `LLM_FALLBACK_PROVIDER` | the other provider | `gemini` or `openai` — triggered on primary failure |
| `LLM_FALLBACK_MODEL` | `gpt-4o-mini` | Model name for the fallback provider |

### Credentials

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Google AI / Gemini API key (direct access) |
| `GEMINI_BASE_URL` | Optional proxy base URL for Gemini-compatible endpoint |
| `OPENAI_API_KEY` | OpenAI API key (or key for any OpenAI-compatible API) |
| `OPENAI_BASE_URL` | Optional custom base URL (Azure, local proxy, etc.) |

**Auto-detection:** if `LLM_PRIMARY_PROVIDER` is not set, the pipeline detects
the primary provider from which credentials are present (`GEMINI_API_KEY` →
Gemini; `OPENAI_API_KEY` → OpenAI; Gemini wins if both are set).

**Fallback:** if the primary provider returns a non-retryable error (5xx,
timeout, empty response), the pipeline automatically retries with the fallback
provider and logs a clear message.

### Quick-start snippets

**Gemini only (cheapest default):**
```bash
export GEMINI_API_KEY=your-google-ai-key
python3 extract.py
```

**OpenAI only:**
```bash
export OPENAI_API_KEY=your-openai-key
export LLM_PRIMARY_PROVIDER=openai
export LLM_PRIMARY_MODEL=gpt-4o-mini   # or gpt-4o for higher accuracy
python3 extract.py
```

**Gemini primary with OpenAI fallback (recommended for production):**
```bash
export GEMINI_API_KEY=your-google-ai-key
export OPENAI_API_KEY=your-openai-key
# LLM_PRIMARY_PROVIDER auto-detected as gemini; fallback defaults to openai
python3 extract.py
```

**Spend guard:**
```bash
export TOKEN_DAILY_CAP_USD=5.0   # stop all LLM calls once $5 is spent today
```

### Backward-compatible aliases

The following older variable names are still accepted for existing deployments:

| Old name | Canonical equivalent |
|---|---|
| `EXTRACT_MODEL` | `LLM_PRIMARY_MODEL` |
| `OPENAI_EXTRACT_MODEL` | `LLM_FALLBACK_MODEL` |

## Notes
- Nationwide ≈ 8,000 search calls + one detail call per matched case → a few hours
  at the polite delay. Fully resumable, so run it in chunks or overnight.
- State commission IDs are derived as `11{state-code}0000`; unused codes are
  skipped automatically.

## Output
- `ejagriti.sqlite` — tables: `commissions`, `cases`, `proceedings`, `search_progress`
- `cases.csv` — one row per case incl. `final_judgement_text`
