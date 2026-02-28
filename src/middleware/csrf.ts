import { NextFunction, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { AppError } from "../utils/appError";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const requireCsrf = async (req: Request, _res: Response, next: NextFunction) => {
  if (!MUTATING_METHODS.has(req.method)) {
    return next();
  }

  if (!req.auth?.userId) {
    return next(new AppError("Unauthorized", 401));
  }

  const csrfToken = req.header("x-csrf-token");
  if (!csrfToken) {
    return next(new AppError("Missing CSRF token", 403));
  }

  const user = await prisma.user.findUnique({
    where: { id: req.auth.userId },
    select: { csrfToken: true },
  });

  if (!user?.csrfToken || user.csrfToken !== csrfToken) {
    return next(new AppError("Invalid CSRF token", 403));
  }

  next();
};
