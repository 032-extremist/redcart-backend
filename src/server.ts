import { app } from "./app";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { prisma } from "./lib/prisma";
import { ensureLowPriceProducts } from "./bootstrap/lowPriceProducts";

const DB_STARTUP_MAX_RETRIES = Number(process.env.DB_STARTUP_MAX_RETRIES ?? 12);
const DB_STARTUP_RETRY_MS = Number(process.env.DB_STARTUP_RETRY_MS ?? 3000);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForDatabase = async () => {
  for (let attempt = 1; attempt <= DB_STARTUP_MAX_RETRIES; attempt++) {
    try {
      await prisma.$connect();
      await prisma.$queryRaw`SELECT 1`;
      logger.info({ attempt }, "Database connection established");
      return;
    } catch (error) {
      logger.error({ attempt, error }, "Database connection check failed");
      await prisma.$disconnect().catch(() => undefined);

      if (attempt === DB_STARTUP_MAX_RETRIES) {
        throw error;
      }

      await sleep(DB_STARTUP_RETRY_MS);
    }
  }
};

let server: ReturnType<typeof app.listen> | undefined;

const shutdown = async () => {
  logger.info("Shutting down RedCart API");
  if (!server) {
    await prisma.$disconnect();
    process.exit(0);
    return;
  }

  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
};

const start = async () => {
  try {
    await waitForDatabase();
    await ensureLowPriceProducts().catch((error) => {
      logger.error({ error }, "Failed to ensure low-price products on startup");
    });
    server = app.listen(env.PORT, () => {
      logger.info(`RedCart API listening on port ${env.PORT}`);
    });
  } catch (error) {
    logger.fatal({ error }, "Failed to initialize database connection on startup");
    process.exit(1);
  }
};

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});

void start();
