import { Router, type IRouter, type Request, type Response } from "express";
import { getAllCases, type CaseRow } from "../lib/sqlite";
import { ListCasesResponse } from "@workspace/api-zod";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Cache configuration
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = Number(process.env["CACHE_TTL_MS"] ?? 43_200_000); // 12 h default
const CACHE_SECRET = process.env["CACHE_SECRET"] ?? "";

interface CacheEntry {
  data: CaseRow[];
  loadedAt: number;
}

let _cache: CacheEntry | null = null;

async function _load(): Promise<CaseRow[]> {
  const data = await getAllCases();
  _cache = { data, loadedAt: Date.now() };
  return data;
}

function _isFresh(): boolean {
  return _cache !== null && Date.now() - _cache.loadedAt < CACHE_TTL_MS;
}

// ---------------------------------------------------------------------------
// SSE — push cache-invalidation events to connected dashboard tabs
// ---------------------------------------------------------------------------

interface SseClient {
  id: number;
  res: Response;
  heartbeat: ReturnType<typeof setInterval>;
}

let _nextClientId = 1;
const _sseClients = new Map<number, SseClient>();

function _addSseClient(res: Response): SseClient {
  const id = _nextClientId++;
  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 30_000);

  const client: SseClient = { id, res, heartbeat };
  _sseClients.set(id, client);
  return client;
}

function _removeSseClient(id: number): void {
  const client = _sseClients.get(id);
  if (client) {
    clearInterval(client.heartbeat);
    _sseClients.delete(id);
  }
}

function _broadcastCacheInvalidated(): void {
  const payload = JSON.stringify({ ts: Date.now() });
  const message = `event: cache-invalidated\ndata: ${payload}\n\n`;
  for (const client of _sseClients.values()) {
    try {
      client.res.write(message);
    } catch {
      _removeSseClient(client.id);
    }
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

router.get("/cases", async (req, res): Promise<void> => {
  try {
    if (!_isFresh()) {
      req.log.info(
        _cache
          ? "TTL expired — reloading cases from PostgreSQL"
          : "Loading cases from PostgreSQL (first request)",
      );
      const data = await _load();
      req.log.info({ count: data.length }, "Cases loaded and cached");
    }
    const validated = ListCasesResponse.parse(_cache!.data);
    res.json(validated);
  } catch (err) {
    req.log.error({ err }, "Failed to load cases");
    res.status(500).json({ error: "Failed to load cases" });
  }
});

/**
 * GET /api/cache/events
 * Server-Sent Events stream.
 */
router.get("/cache/events", (req, res): void => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  res.write(": connected\n\n");

  const client = _addSseClient(res);
  req.log.info({ clientId: client.id, total: _sseClients.size }, "SSE client connected");

  req.on("close", () => {
    req.log.info({ clientId: client.id }, "SSE client disconnected");
    _removeSseClient(client.id);
  });
});

router.post("/cache/invalidate", (req, res): void => {
  const secret = req.headers["x-cache-secret"] as string | undefined;

  if (!CACHE_SECRET || secret !== CACHE_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  _cache = null;
  req.log.info(
    { sseClients: _sseClients.size },
    "Cache invalidated via POST /api/cache/invalidate",
  );

  _broadcastCacheInvalidated();

  res.status(204).end();
});

/**
 * Warm the in-memory case cache at startup.
 * pg queries are non-blocking so no setImmediate wrapper is needed — the
 * promise resolves asynchronously without blocking the event loop.
 */
export function warmCache(): void {
  if (_isFresh()) return;
  const t0 = Date.now();
  logger.info("Warming /api/cases cache at startup…");
  _load()
    .then(() => {
      logger.info(
        { count: _cache!.data.length, ms: Date.now() - t0 },
        "Startup cache warm complete",
      );
    })
    .catch((err) => {
      logger.error(
        { err },
        "Startup cache warm failed — will retry on first request",
      );
    });
}

export default router;
