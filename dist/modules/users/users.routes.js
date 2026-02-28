"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../../middleware/auth");
const csrf_1 = require("../../middleware/csrf");
const validate_1 = require("../../middleware/validate");
const prisma_1 = require("../../lib/prisma");
const router = (0, express_1.Router)();
const updateProfileSchema = zod_1.z.object({
    body: zod_1.z.object({
        firstName: zod_1.z.string().min(1).optional(),
        lastName: zod_1.z.string().min(1).optional(),
        phone: zod_1.z.string().optional(),
    }),
    query: zod_1.z.object({}),
    params: zod_1.z.object({}),
});
router.use(auth_1.authenticate);
router.get("/profile", async (req, res, next) => {
    try {
        const profile = await prisma_1.prisma.user.findUnique({
            where: { id: req.auth.userId },
            select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                phone: true,
                role: true,
                createdAt: true,
            },
        });
        res.json(profile);
    }
    catch (error) {
        next(error);
    }
});
router.patch("/profile", csrf_1.requireCsrf, (0, validate_1.validate)(updateProfileSchema), async (req, res, next) => {
    try {
        const profile = await prisma_1.prisma.user.update({
            where: { id: req.auth.userId },
            data: req.body,
            select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                phone: true,
                role: true,
                createdAt: true,
            },
        });
        res.json(profile);
    }
    catch (error) {
        next(error);
    }
});
exports.default = router;
