import { NextFunction, Request, Response } from "express";
import { Role } from "@prisma/client";
import { verifyJwt } from "../utils/jwt";
import { AppError } from "../utils/appError";

export const authenticate = (req: Request, _res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return next(new AppError("Unauthorized", 401));
  }

  const token = header.replace("Bearer ", "").trim();

  try {
    const payload = verifyJwt(token);
    req.auth = {
      userId: payload.userId,
      role: payload.role,
    };
    next();
  } catch {
    next(new AppError("Invalid token", 401));
  }
};

export const optionalAuthenticate = (req: Request, _res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return next();
  }

  const token = header.replace("Bearer ", "").trim();

  try {
    const payload = verifyJwt(token);
    req.auth = {
      userId: payload.userId,
      role: payload.role,
    };
  } catch {
    req.auth = undefined;
  }

  next();
};

export const requireRole = (...roles: Role[]) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.auth) {
    return next(new AppError("Unauthorized", 401));
  }

  if (!roles.includes(req.auth.role)) {
    return next(new AppError("Forbidden", 403));
  }

  next();
};
