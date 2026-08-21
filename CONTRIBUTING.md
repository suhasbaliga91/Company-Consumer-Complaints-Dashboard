# Contributing

## Development notes

Operational gotchas worth knowing before touching the scraper/extraction pipeline:

### Gemini API endpoint

Call `{base}/models/{model}:generateContent` directly via `requests.post()`, where
`base` is either `https://generativelanguage.googleapis.com/v1beta` (direct, using
`GEMINI_API_KEY`) or the value of `GEMINI_BASE_URL` (proxy). The `google-genai`
Python SDK appends its own path prefix and uses its own auth flow, which is
incompatible with proxy endpoints — the pipeline uses raw `requests.post()`
instead (`scraper/llm.py`, `_call_gemini()`) to stay portable across direct
Google API access and any Gemini-compatible proxy.

- **JSON mode:** use `"generationConfig": {"responseMimeType": "application/json", "maxOutputTokens": 4096}`.
- **System instructions:** use `"system_instruction": {"parts": [{"text": "..."}]}` alongside `"contents"` — not the `messages` array format.
- **Retry-After header:** the API (and compatible proxies) may return `Retry-After` as an HTTP-date string (`Sat, 18 Jul 2026 11:58:00 GMT`), not numeric seconds. Parse with `_parse_retry_after()`, which tries `float()` first, then falls back to `email.utils.parsedate_to_datetime()`.

### Extraction pipeline (`scraper/extract.py`)

- Provider selection is centralized in `scraper/llm.py`. OpenAI is the fallback and uses the OpenAI SDK with `response_format={"type":"json_object"}`.
- Cases with judgment text shorter than `MIN_TEXT_CHARS` (200 chars) must be written to the DB with `extraction_status='text_too_short'`. Without this they cycle through every batch indefinitely, since the query re-selects unextracted cases with text > 50 chars.
- Each worker thread must create its own `sqlite3.Connection` via `threading.local()` — a connection created in the main thread can't be used from worker threads (raises "SQLite objects created in a thread can only be used in that same thread").

### API client regeneration

When a field is added to the OpenAPI spec (`lib/api-spec/openapi.yaml`) and
regenerated into `lib/api-client-react/src/generated/api.schemas.ts`, the
compiled declarations in `lib/api-client-react/dist/` go stale. Run
`pnpm --filter @workspace/api-spec run codegen` to regenerate everything, or
`npx tsc -p tsconfig.json` in `lib/api-client-react/` and `lib/api-zod/`
directly. The dashboard's typecheck resolves against the `dist` declarations
(via TypeScript project references in `artifacts/dashboard/tsconfig.json`),
not the source.

### Git rebase: binary SQLite conflict

In a `git rebase`, `--ours` is the upstream branch and `--theirs` is the
commit being rebased. For a conflict on `scraper/ejagriti.sqlite`, use
`git checkout --theirs scraper/ejagriti.sqlite` to keep the populated data
from the commit being rebased.
