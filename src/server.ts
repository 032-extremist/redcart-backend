import { app } from "./app";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { prisma } from "./lib/prisma";

const server = app.listen(env.PORT, () => {
  logger.info(`RedCart API listening on port ${env.PORT}`);
});

const shutdown = async () => {
  logger.info("Shutting down RedCart API");
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
