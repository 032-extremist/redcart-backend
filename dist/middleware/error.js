"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = exports.notFoundHandler = void 0;
const client_1 = require("@prisma/client");
const zod_1 = require("zod");
const appError_1 = require("../utils/appError");
const logger_1 = require("../config/logger");
const notFoundHandler = (req, res) => {
    res.status(404).json({
        message: "Route not found",
        method: req.method,
        path: req.originalUrl,
        hint: "Use /api/v1/<resource> or /api/<resource>, for example /api/v1/health",
    });
};
exports.notFoundHandler = notFoundHandler;
const errorHandler = (error, _req, res, _next) => {
    if (error instanceof appError_1.AppError) {
        return res.status(error.statusCode).json({ message: error.message });
    }
    if (error instanceof client_1.Prisma.PrismaClientKnownRequestError) {
        logger_1.logger.error({ error }, "Prisma request error");
        if (error.code === "P6001") {
            return res.status(500).json({
                message: "Database engine configuration error (P6001). Ensure Prisma uses local 'library' engine and DATABASE_URL is a valid postgresql:// URL.",
                code: error.code,
            });
        }
        return res.status(500).json({
            message: error.message,
            code: error.code,
        });
    }
    if (error instanceof client_1.Prisma.PrismaClientInitializationError) {
        logger_1.logger.error({ error }, "Prisma initialization error");
        return res.status(500).json({
            message: error.message,
            code: error.errorCode ?? "PRISMA_INIT_ERROR",
        });
    }
    if (error && typeof error === "object" && "name" in error && error.name === "MulterError") {
        const multerCode = error.code;
        if (multerCode === "LIMIT_FILE_SIZE") {
            return res.status(400).json({ message: "Image upload failed: file exceeds 5MB limit" });
        }
        return res.status(400).json({ message: "Image upload failed" });
    }
    if (error instanceof zod_1.ZodError) {
        return res.status(422).json({
            message: "Validation failed",
            errors: error.flatten(),
        });
    }
    logger_1.logger.error({ error }, "Unhandled error");
    return res.status(500).json({ message: "Internal server error" });
};
exports.errorHandler = errorHandler;
