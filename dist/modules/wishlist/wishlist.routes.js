"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../../middleware/auth");
const csrf_1 = require("../../middleware/csrf");
const validate_1 = require("../../middleware/validate");
const prisma_1 = require("../../lib/prisma");
const router = (0, express_1.Router)();
const addWishlistSchema = zod_1.z.object({
    body: zod_1.z.object({ productId: zod_1.z.string().min(1) }),
    query: zod_1.z.object({}),
    params: zod_1.z.object({}),
});
const deleteWishlistSchema = zod_1.z.object({
    body: zod_1.z.object({}),
    query: zod_1.z.object({}),
    params: zod_1.z.object({ productId: zod_1.z.string().min(1) }),
});
router.use(auth_1.authenticate);
router.get("/", async (req, res, next) => {
    try {
        const data = await prisma_1.prisma.wishlistItem.findMany({
            where: { userId: req.auth.userId },
            include: {
                product: {
                    include: {
                        category: { select: { name: true, slug: true } },
                        subcategory: { select: { name: true, slug: true } },
                    },
                },
            },
            orderBy: { createdAt: "desc" },
        });
        res.json(data.map((item) => ({
            ...item,
            product: {
                ...item.product,
                price: Number(item.product.price),
            },
        })));
    }
    catch (error) {
        next(error);
    }
});
router.post("/", csrf_1.requireCsrf, (0, validate_1.validate)(addWishlistSchema), async (req, res, next) => {
    try {
        const created = await prisma_1.prisma.wishlistItem.upsert({
            where: {
                userId_productId: {
                    userId: req.auth.userId,
                    productId: req.body.productId,
                },
            },
            create: {
                userId: req.auth.userId,
                productId: req.body.productId,
            },
            update: {},
            include: {
                product: true,
            },
        });
        res.status(201).json(created);
    }
    catch (error) {
        next(error);
    }
});
router.delete("/:productId", csrf_1.requireCsrf, (0, validate_1.validate)(deleteWishlistSchema), async (req, res, next) => {
    try {
        await prisma_1.prisma.wishlistItem.deleteMany({
            where: {
                userId: req.auth.userId,
                productId: req.params.productId,
            },
        });
        res.status(204).send();
    }
    catch (error) {
        next(error);
    }
});
exports.default = router;
