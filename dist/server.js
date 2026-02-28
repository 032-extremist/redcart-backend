"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = require("./app");
const env_1 = require("./config/env");
const logger_1 = require("./config/logger");
const prisma_1 = require("./lib/prisma");
const server = app_1.app.listen(env_1.env.PORT, () => {
    logger_1.logger.info(`RedCart API listening on port ${env_1.env.PORT}`);
});
const shutdown = async () => {
    logger_1.logger.info("Shutting down RedCart API");
    server.close(async () => {
        await prisma_1.prisma.$disconnect();
        process.exit(0);
    });
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
