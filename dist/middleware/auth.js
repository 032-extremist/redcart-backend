"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireRole = exports.optionalAuthenticate = exports.authenticate = void 0;
const jwt_1 = require("../utils/jwt");
const appError_1 = require("../utils/appError");
const authenticate = (req, _res, next) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
        return next(new appError_1.AppError("Unauthorized", 401));
    }
    const token = header.replace("Bearer ", "").trim();
    try {
        const payload = (0, jwt_1.verifyJwt)(token);
        req.auth = {
            userId: payload.userId,
            role: payload.role,
        };
        next();
    }
    catch {
        next(new appError_1.AppError("Invalid token", 401));
    }
};
exports.authenticate = authenticate;
const optionalAuthenticate = (req, _res, next) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
        return next();
    }
    const token = header.replace("Bearer ", "").trim();
    try {
        const payload = (0, jwt_1.verifyJwt)(token);
        req.auth = {
            userId: payload.userId,
            role: payload.role,
        };
    }
    catch {
        req.auth = undefined;
    }
    next();
};
exports.optionalAuthenticate = optionalAuthenticate;
const requireRole = (...roles) => (req, _res, next) => {
    if (!req.auth) {
        return next(new appError_1.AppError("Unauthorized", 401));
    }
    if (!roles.includes(req.auth.role)) {
        return next(new appError_1.AppError("Forbidden", 403));
    }
    next();
};
exports.requireRole = requireRole;
