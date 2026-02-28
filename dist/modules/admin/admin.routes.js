"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../../middleware/auth");
const csrf_1 = require("../../middleware/csrf");
const validate_1 = require("../../middleware/validate");
const prisma_1 = require("../../lib/prisma");
const slugify_1 = require("../../utils/slugify");
const appError_1 = require("../../utils/appError");
const router = (0, express_1.Router)();
const createProductSchema = zod_1.z.object({
    body: zod_1.z.object({
        name: zod_1.z.string().min(2),
        description: zod_1.z.string().min(10),
        price: zod_1.z.number().positive(),
        stock: zod_1.z.number().int().min(0),
        imageUrl: zod_1.z.string().url(),
        categoryId: zod_1.z.number().int().positive(),
        subcategoryId: zod_1.z.number().int().positive().optional(),
        isFeatured: zod_1.z.boolean().default(false),
    }),
    query: zod_1.z.object({}),
    params: zod_1.z.object({}),
});
const updateProductSchema = zod_1.z.object({
    body: zod_1.z.object({
        name: zod_1.z.string().min(2).optional(),
        description: zod_1.z.string().min(10).optional(),
        price: zod_1.z.number().positive().optional(),
        stock: zod_1.z.number().int().min(0).optional(),
        imageUrl: zod_1.z.string().url().optional(),
        categoryId: zod_1.z.number().int().positive().optional(),
        subcategoryId: zod_1.z.number().int().positive().nullable().optional(),
        isFeatured: zod_1.z.boolean().optional(),
    }),
    query: zod_1.z.object({}),
    params: zod_1.z.object({ productId: zod_1.z.string().min(1) }),
});
const productIdSchema = zod_1.z.object({
    body: zod_1.z.object({}),
    query: zod_1.z.object({}),
    params: zod_1.z.object({ productId: zod_1.z.string().min(1) }),
});
const stockUpdateSchema = zod_1.z.object({
    body: zod_1.z.object({
        delta: zod_1.z.number().int().refine((v) => v !== 0, "Delta cannot be zero"),
        reason: zod_1.z.string().min(2),
    }),
    query: zod_1.z.object({}),
    params: zod_1.z.object({ productId: zod_1.z.string().min(1) }),
});
router.use(auth_1.authenticate, (0, auth_1.requireRole)(client_1.Role.ADMIN));
router.get("/analytics/sales", async (_req, res, next) => {
    try {
        const [ordersCount, revenueAgg, pendingPayments, topProducts] = await Promise.all([
            prisma_1.prisma.order.count(),
            prisma_1.prisma.order.aggregate({
                _sum: { total: true },
            }),
            prisma_1.prisma.payment.count({ where: { status: "PENDING" } }),
            prisma_1.prisma.orderItem.groupBy({
                by: ["productId"],
                _sum: { quantity: true, subtotal: true },
                orderBy: {
                    _sum: {
                        subtotal: "desc",
                    },
                },
                take: 5,
            }),
        ]);
        const products = await prisma_1.prisma.product.findMany({
            where: { id: { in: topProducts.map((item) => item.productId) } },
            select: { id: true, name: true },
        });
        const productName = new Map(products.map((product) => [product.id, product.name]));
        res.json({
            ordersCount,
            totalRevenue: Number(revenueAgg._sum.total ?? 0),
            pendingPayments,
            topProducts: topProducts.map((item) => ({
                productId: item.productId,
                productName: productName.get(item.productId) ?? "Unknown",
                quantitySold: item._sum.quantity ?? 0,
                revenue: Number(item._sum.subtotal ?? 0),
            })),
        });
    }
    catch (error) {
        next(error);
    }
});
router.post("/products", csrf_1.requireCsrf, (0, validate_1.validate)(createProductSchema), async (req, res, next) => {
    try {
        const { name, ...rest } = req.body;
        const product = await prisma_1.prisma.product.create({
            data: {
                ...rest,
                name,
                slug: (0, slugify_1.slugify)(name),
            },
        });
        res.status(201).json({ ...product, price: Number(product.price) });
    }
    catch (error) {
        next(error);
    }
});
router.patch("/products/:productId", csrf_1.requireCsrf, (0, validate_1.validate)(updateProductSchema), async (req, res, next) => {
    try {
        const { productId } = req.params;
        const current = await prisma_1.prisma.product.findUnique({ where: { id: productId } });
        if (!current) {
            throw new appError_1.AppError("Product not found", 404);
        }
        const nextSlug = req.body.name ? (0, slugify_1.slugify)(req.body.name) : current.slug;
        const product = await prisma_1.prisma.product.update({
            where: { id: productId },
            data: {
                ...req.body,
                slug: nextSlug,
            },
        });
        res.json({ ...product, price: Number(product.price) });
    }
    catch (error) {
        next(error);
    }
});
router.delete("/products/:productId", csrf_1.requireCsrf, (0, validate_1.validate)(productIdSchema), async (req, res, next) => {
    try {
        await prisma_1.prisma.product.delete({ where: { id: req.params.productId } });
        res.status(204).send();
    }
    catch (error) {
        next(error);
    }
});
router.post("/products/:productId/stock", csrf_1.requireCsrf, (0, validate_1.validate)(stockUpdateSchema), async (req, res, next) => {
    try {
        const { productId } = req.params;
        const { delta, reason } = req.body;
        const product = await prisma_1.prisma.product.findUnique({ where: { id: productId } });
        if (!product) {
            throw new appError_1.AppError("Product not found", 404);
        }
        const nextStock = product.stock + delta;
        if (nextStock < 0) {
            throw new appError_1.AppError("Stock cannot be negative", 400);
        }
        const updated = await prisma_1.prisma.$transaction(async (tx) => {
            const nextProduct = await tx.product.update({
                where: { id: productId },
                data: { stock: nextStock },
            });
            await tx.productStockLog.create({
                data: {
                    productId,
                    delta,
                    reason,
                },
            });
            return nextProduct;
        });
        res.json({ ...updated, price: Number(updated.price) });
    }
    catch (error) {
        next(error);
    }
});
exports.default = router;
