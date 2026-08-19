import app from "./app";
import { logger } from "./lib/logger";
import { warmCache } from "./routes/cases";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Warm the PostgreSQL-backed case cache immediately after the port is bound.
  // pg queries are non-blocking so this does not hold up health-check responses.
  warmCache();
});
