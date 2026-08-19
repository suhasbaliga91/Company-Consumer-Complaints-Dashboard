# Consumer Complaints Dashboard

Monitor a company's consumer-court cases filed on India's [e-Jagriti](https://e-jagriti.gov.in)
portal: scrape case data and full judgment text, classify it with an LLM, and browse
the results in a dashboard.

The project is company-agnostic — every deployment targets one company, configured
entirely through environment variables (no code changes needed). See
[`scraper/company.py`](scraper/company.py) and [`scraper/.env.example`](scraper/.env.example).

## Layout

This is a pnpm monorepo:

| Path | What it is |
|---|---|
| `scraper/` | Python pipeline: harvests cases + judgment text from e-Jagriti, classifies them with an LLM (Gemini/OpenAI), writes to Postgres/SQLite. See [`scraper/README.md`](scraper/README.md). |
| `artifacts/api-server/` | Express API server (`@workspace/api-server`) that serves case data to the dashboard, with a cache-invalidation endpoint the scraper pings after each run. |
| `artifacts/dashboard/` | React/Vite dashboard (`@workspace/dashboard`) for browsing and filtering cases. |
| `lib/db/` | Drizzle ORM schema/config for the Postgres database (`@workspace/db`). |
| `lib/api-spec/` | OpenAPI spec (source of truth for the API contract) + codegen config. |
| `lib/api-zod/`, `lib/api-client-react/` | Generated Zod schemas and React Query client — regenerate with `pnpm --filter @workspace/api-spec run codegen` after editing `lib/api-spec/openapi.yaml`. |
| `scripts/` | Small workspace utility scripts (`@workspace/scripts`). |

## Quickstart

### 1. Scrape and classify cases

```bash
cd scraper
pip install -r requirements.txt
cp .env.example .env   # fill in your LLM key + target company, see scraper/README.md
export $(grep -v '^#' .env | xargs)   # or use your preferred env loader

python3 main.py        # harvest case metadata
python3 judgements.py  # harvest full judgment text
python3 extract.py     # LLM classification pass
```

### 2. Run the API server + dashboard

```bash
pnpm install

# Configure lib/db (DATABASE_URL) and push the schema
pnpm --filter @workspace/db run push

# Start the API server (reads DATABASE_URL, PORT, CACHE_SECRET)
pnpm --filter @workspace/api-server run dev

# Start the dashboard (in another shell)
pnpm --filter @workspace/dashboard run dev
```

See `scraper/.env.example` for the full list of environment variables shared
across the scraper, API server, and dashboard sync pipeline.

## Deploying to a new company

1. Set `OPPOSITE_PARTY` (and optionally `COMPANY_NAME`) to the company you want to
   track — see [`scraper/company.py`](scraper/company.py) for how the filter works.
2. Point `DATABASE_URL` at your own Postgres instance and run `pnpm --filter @workspace/db run push`.
3. Set LLM credentials (`GEMINI_API_KEY` and/or `OPENAI_API_KEY`).
4. Deploy `artifacts/api-server` and `artifacts/dashboard` however you like — both
   are plain Node/Vite builds with no platform-specific dependencies.

## License

MIT — see [LICENSE](LICENSE).
