import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// CORS_ORIGIN: comma-separated allowlist of origins, e.g.
// "https://dashboard.example.com,https://admin.example.com". Unset or "*"
// (the default) keeps today's open-to-any-origin behavior.
const corsOrigin = process.env["CORS_ORIGIN"]?.trim();
const corsOptions =
  !corsOrigin || corsOrigin === "*"
    ? undefined
    : { origin: corsOrigin.split(",").map((o) => o.trim()).filter(Boolean) };
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
