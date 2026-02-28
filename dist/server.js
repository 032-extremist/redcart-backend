"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = require("./app");
const env_1 = require("./config/env");
const logger_1 = require("./config/logger");
const prisma_1 = require("./lib/prisma");
const lowPriceProducts_1 = require("./bootstrap/lowPriceProducts");
const DB_STARTUP_MAX_RETRIES = Number(process.env.DB_STARTUP_MAX_RETRIES ?? 12);
const DB_STARTUP_RETRY_MS = Number(process.env.DB_STARTUP_RETRY_MS ?? 3000);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitForDatabase = async () => {
    for (let attempt = 1; attempt <= DB_STARTUP_MAX_RETRIES; attempt++) {
        try {
            await prisma_1.prisma.$connect();
            await prisma_1.prisma.$queryRaw `SELECT 1`;
            logger_1.logger.info({ attempt }, "Database connection established");
            return;
        }
        catch (error) {
            logger_1.logger.error({ attempt, error }, "Database connection check failed");
            await prisma_1.prisma.$disconnect().catch(() => undefined);
            if (attempt === DB_STARTUP_MAX_RETRIES) {
                throw error;
            }
            await sleep(DB_STARTUP_RETRY_MS);
        }
    }
};
let server;
const shutdown = async () => {
    logger_1.logger.info("Shutting down RedCart API");
    if (!server) {
        await prisma_1.prisma.$disconnect();
        process.exit(0);
        return;
    }
    server.close(async () => {
        await prisma_1.prisma.$disconnect();
        process.exit(0);
    });
};
const start = async () => {
    try {
        await waitForDatabase();
        await (0, lowPriceProducts_1.ensureLowPriceProducts)().catch((error) => {
            logger_1.logger.error({ error }, "Failed to ensure low-price products on startup");
        });
        server = app_1.app.listen(env_1.env.PORT, () => {
            logger_1.logger.info(`RedCart API listening on port ${env_1.env.PORT}`);
        });
    }
    catch (error) {
        logger_1.logger.fatal({ error }, "Failed to initialize database connection on startup");
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
