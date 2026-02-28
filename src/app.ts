import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import morgan from "morgan";
import path from "path";
import { env } from "./config/env";
import apiRoutes from "./routes";
import { errorHandler, notFoundHandler } from "./middleware/error";

export const app = express();
const allowedOrigins = env.CLIENT_URL.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const isHostedRuntime =
  process.env.RENDER === "true" ||
  Boolean(
    process.env.RAILWAY_ENVIRONMENT ||
      process.env.RAILWAY_ENVIRONMENT_ID ||
      process.env.RAILWAY_PROJECT_ID ||
      process.env.FLY_APP_NAME,
  );

if (env.NODE_ENV === "production" || isHostedRuntime) {
  app.set("trust proxy", 1);
}

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
    exposedHeaders: ["X-Receipt-Email-Status", "X-Receipt-Email-Reason", "X-Receipt-Email-Message-Id"],
  }),
);
app.use(helmet());
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));
app.use("/uploads", express.static(path.resolve(process.cwd(), "uploads")));

app.use(
  "/api",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);

app.get("/", (_req, res) => {
  res.json({
    service: "RedCart API",
    health: "/api/v1/health",
    docsHint: "All API routes are under /api/v1",
  });
});

app.get("/health", (_req, res) => {
  res.redirect(307, "/api/v1/health");
});

app.use("/api", apiRoutes);
app.use("/api/v1", apiRoutes);

app.use(notFoundHandler);
app.use(errorHandler);
