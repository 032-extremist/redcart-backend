"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const crypto_1 = __importDefault(require("crypto"));
const zod_1 = require("zod");
const validate_1 = require("../../middleware/validate");
const prisma_1 = require("../../lib/prisma");
const appError_1 = require("../../utils/appError");
const jwt_1 = require("../../utils/jwt");
const auth_1 = require("../../middleware/auth");
const csrf_1 = require("../../middleware/csrf");
const router = (0, express_1.Router)();
const registerSchema = zod_1.z.object({
    body: zod_1.z.object({
        email: zod_1.z.string().email(),
        password: zod_1.z
            .string()
            .min(8)
            .regex(/[A-Z]/, "Password must include an uppercase letter")
            .regex(/[0-9]/, "Password must include a number"),
        firstName: zod_1.z.string().min(1),
        lastName: zod_1.z.string().min(1),
        phone: zod_1.z.string().optional(),
    }),
    query: zod_1.z.object({}),
    params: zod_1.z.object({}),
});
const loginSchema = zod_1.z.object({
    body: zod_1.z.object({
        email: zod_1.z.string().email(),
        password: zod_1.z.string().min(1),
    }),
    query: zod_1.z.object({}),
    params: zod_1.z.object({}),
});
const passwordResetRequestSchema = zod_1.z.object({
    body: zod_1.z.object({ email: zod_1.z.string().email() }),
    query: zod_1.z.object({}),
    params: zod_1.z.object({}),
});
const passwordResetConfirmSchema = zod_1.z.object({
    body: zod_1.z.object({
        email: zod_1.z.string().email(),
        newPassword: zod_1.z
            .string()
            .min(8)
            .regex(/[A-Z]/, "Password must include an uppercase letter")
            .regex(/[0-9]/, "Password must include a number"),
    }),
    query: zod_1.z.object({}),
    params: zod_1.z.object({}),
});
router.post("/register", (0, validate_1.validate)(registerSchema), async (req, res, next) => {
    try {
        const { email, password, firstName, lastName, phone } = req.body;
        const existing = await prisma_1.prisma.user.findUnique({ where: { email } });
        if (existing) {
            throw new appError_1.AppError("Email is already in use", 409);
        }
        const passwordHash = await bcryptjs_1.default.hash(password, 12);
        const csrfToken = crypto_1.default.randomBytes(24).toString("hex");
        const user = await prisma_1.prisma.user.create({
            data: {
                email,
                passwordHash,
                firstName,
                lastName,
                phone,
                csrfToken,
                cart: { create: {} },
            },
        });
        const token = (0, jwt_1.signJwt)({ userId: user.id, role: user.role });
        res.status(201).json({
            token,
            csrfToken,
            user: {
                id: user.id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                role: user.role,
            },
        });
    }
    catch (error) {
        next(error);
    }
});
router.post("/login", (0, validate_1.validate)(loginSchema), async (req, res, next) => {
    try {
        const { email, password } = req.body;
        const user = await prisma_1.prisma.user.findUnique({ where: { email } });
        if (!user) {
            throw new appError_1.AppError("Invalid credentials", 401);
        }
        const valid = await bcryptjs_1.default.compare(password, user.passwordHash);
        if (!valid) {
            throw new appError_1.AppError("Invalid credentials", 401);
        }
        const csrfToken = crypto_1.default.randomBytes(24).toString("hex");
        await prisma_1.prisma.user.update({
            where: { id: user.id },
            data: { csrfToken },
        });
        const token = (0, jwt_1.signJwt)({ userId: user.id, role: user.role });
        res.json({
            token,
            csrfToken,
            user: {
                id: user.id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                role: user.role,
            },
        });
    }
    catch (error) {
        next(error);
    }
});
router.get("/me", auth_1.authenticate, async (req, res, next) => {
    try {
        const user = await prisma_1.prisma.user.findUnique({
            where: { id: req.auth.userId },
            select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                phone: true,
                role: true,
                createdAt: true,
                csrfToken: true,
            },
        });
        if (!user) {
            throw new appError_1.AppError("User not found", 404);
        }
        const csrfToken = user.csrfToken ?? crypto_1.default.randomBytes(24).toString("hex");
        if (!user.csrfToken) {
            await prisma_1.prisma.user.update({
                where: { id: user.id },
                data: { csrfToken },
            });
        }
        res.json({
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            phone: user.phone,
            role: user.role,
            createdAt: user.createdAt,
            csrfToken,
        });
    }
    catch (error) {
        next(error);
    }
});
router.post("/logout", auth_1.authenticate, csrf_1.requireCsrf, async (req, res, next) => {
    try {
        await prisma_1.prisma.user.update({
            where: { id: req.auth.userId },
            data: { csrfToken: null },
        });
        res.status(204).send();
    }
    catch (error) {
        next(error);
    }
});
router.post("/password-reset/request", (0, validate_1.validate)(passwordResetRequestSchema), async (req, res, next) => {
    try {
        const { email } = req.body;
        const exists = await prisma_1.prisma.user.findUnique({ where: { email }, select: { id: true } });
        res.json({
            message: "If the email exists, a reset instruction has been queued.",
            queued: Boolean(exists),
        });
    }
    catch (error) {
        next(error);
    }
});
router.post("/password-reset/confirm", (0, validate_1.validate)(passwordResetConfirmSchema), async (req, res, next) => {
    try {
        const { email, newPassword } = req.body;
        const user = await prisma_1.prisma.user.findUnique({ where: { email } });
        if (!user) {
            throw new appError_1.AppError("User not found", 404);
        }
        const passwordHash = await bcryptjs_1.default.hash(newPassword, 12);
        await prisma_1.prisma.user.update({
            where: { id: user.id },
            data: { passwordHash },
        });
        res.json({ message: "Password has been reset" });
    }
    catch (error) {
        next(error);
    }
});
exports.default = router;
