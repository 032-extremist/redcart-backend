"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../../middleware/auth");
const csrf_1 = require("../../middleware/csrf");
const validate_1 = require("../../middleware/validate");
const prisma_1 = require("../../lib/prisma");
const appError_1 = require("../../utils/appError");
const router = (0, express_1.Router)();
const createReviewSchema = zod_1.z.object({
    body: zod_1.z.object({
        productId: zod_1.z.string().min(1),
        rating: zod_1.z.number().int().min(1).max(5),
        comment: zod_1.z.string().min(2).max(500),
    }),
    query: zod_1.z.object({}),
    params: zod_1.z.object({}),
});
const productReviewsSchema = zod_1.z.object({
    body: zod_1.z.object({}),
    query: zod_1.z.object({}),
    params: zod_1.z.object({ productId: zod_1.z.string().min(1) }),
});
router.get("/product/:productId", (0, validate_1.validate)(productReviewsSchema), async (req, res, next) => {
    try {
        const reviews = await prisma_1.prisma.review.findMany({
            where: { productId: req.params.productId },
            include: {
                user: {
                    select: {
                        firstName: true,
                        lastName: true,
                    },
                },
            },
            orderBy: { createdAt: "desc" },
        });
        res.json(reviews);
    }
    catch (error) {
        next(error);
    }
});
router.post("/", auth_1.authenticate, csrf_1.requireCsrf, (0, validate_1.validate)(createReviewSchema), async (req, res, next) => {
    try {
        const { productId, rating, comment } = req.body;
        const product = await prisma_1.prisma.product.findUnique({ where: { id: productId } });
        if (!product) {
            throw new appError_1.AppError("Product not found", 404);
        }
        const review = await prisma_1.prisma.review.upsert({
            where: {
                userId_productId: {
                    userId: req.auth.userId,
                    productId,
                },
            },
            create: {
                userId: req.auth.userId,
                productId,
                rating,
                comment,
            },
            update: {
                rating,
                comment,
            },
        });
        const aggregate = await prisma_1.prisma.review.aggregate({
            where: { productId },
            _avg: { rating: true },
            _count: { _all: true },
        });
        await prisma_1.prisma.product.update({
            where: { id: productId },
            data: {
                rating: aggregate._avg.rating ?? 0,
                reviewCount: aggregate._count._all,
            },
        });
        res.status(201).json(review);
    }
    catch (error) {
        next(error);
    }
});
exports.default = router;
