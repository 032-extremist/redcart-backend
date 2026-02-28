"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireCsrf = void 0;
const prisma_1 = require("../lib/prisma");
const appError_1 = require("../utils/appError");
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const requireCsrf = async (req, _res, next) => {
    if (!MUTATING_METHODS.has(req.method)) {
        return next();
    }
    if (!req.auth?.userId) {
        return next(new appError_1.AppError("Unauthorized", 401));
    }
    const csrfToken = req.header("x-csrf-token");
    if (!csrfToken) {
        return next(new appError_1.AppError("Missing CSRF token", 403));
    }
    const user = await prisma_1.prisma.user.findUnique({
        where: { id: req.auth.userId },
        select: { csrfToken: true },
    });
    if (!user?.csrfToken || user.csrfToken !== csrfToken) {
        return next(new appError_1.AppError("Invalid CSRF token", 403));
    }
    next();
};
exports.requireCsrf = requireCsrf;
