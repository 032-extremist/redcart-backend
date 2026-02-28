import { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { AppError } from "../utils/appError";
import { logger } from "../config/logger";

export const notFoundHandler = (req: Request, res: Response) => {
  res.status(404).json({
    message: "Route not found",
    method: req.method,
    path: req.originalUrl,
    hint: "Use /api/v1/<resource> or /api/<resource>, for example /api/v1/health",
  });
};

export const errorHandler = (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof AppError) {
    return res.status(error.statusCode).json({ message: error.message });
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    logger.error({ error }, "Prisma request error");

    if (error.code === "P6001") {
      return res.status(500).json({
        message:
          "Database engine configuration error (P6001). Ensure Prisma uses local 'library' engine and DATABASE_URL is a valid postgresql:// URL.",
        code: error.code,
      });
    }

    return res.status(500).json({
      message: error.message,
      code: error.code,
    });
  }

  if (error instanceof Prisma.PrismaClientInitializationError) {
    logger.error({ error }, "Prisma initialization error");
    return res.status(500).json({
      message: error.message,
      code: error.errorCode ?? "PRISMA_INIT_ERROR",
    });
  }

  if (error && typeof error === "object" && "name" in error && (error as { name: string }).name === "MulterError") {
    const multerCode = (error as { code?: string }).code;
    if (multerCode === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ message: "Image upload failed: file exceeds 5MB limit" });
    }

    return res.status(400).json({ message: "Image upload failed" });
  }

  if (error instanceof ZodError) {
    return res.status(422).json({
      message: "Validation failed",
      errors: error.flatten(),
    });
  }

  logger.error({ error }, "Unhandled error");
  return res.status(500).json({ message: "Internal server error" });
};
