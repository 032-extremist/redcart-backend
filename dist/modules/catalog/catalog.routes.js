"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const validate_1 = require("../../middleware/validate");
const prisma_1 = require("../../lib/prisma");
const serializers_1 = require("../../utils/serializers");
const appError_1 = require("../../utils/appError");
const router = (0, express_1.Router)();
const listProductsSchema = zod_1.z.object({
    body: zod_1.z.object({}),
    params: zod_1.z.object({}),
    query: zod_1.z.object({
        page: zod_1.z.coerce.number().min(1).default(1),
        limit: zod_1.z.coerce.number().min(1).max(48).default(12),
        category: zod_1.z.string().optional(),
        subcategory: zod_1.z.string().optional(),
        search: zod_1.z.string().optional(),
        sort: zod_1.z
            .enum(["newest", "price_low_high", "price_high_low", "rating"])
            .default("newest"),
        featured: zod_1.z.coerce.boolean().optional(),
    }),
});
const singleProductSchema = zod_1.z.object({
    body: zod_1.z.object({}),
    query: zod_1.z.object({}),
    params: zod_1.z.object({ productIdOrSlug: zod_1.z.string().min(1) }),
});
const sortToOrderBy = {
    newest: { createdAt: "desc" },
    price_low_high: { price: "asc" },
    price_high_low: { price: "desc" },
    rating: { rating: "desc" },
};
router.get("/categories", async (_req, res, next) => {
    try {
        const categories = await prisma_1.prisma.category.findMany({
            include: {
                subcategories: {
                    orderBy: { name: "asc" },
                },
            },
            orderBy: { name: "asc" },
        });
        res.json(categories);
    }
    catch (error) {
        next(error);
    }
});
router.get("/products", (0, validate_1.validate)(listProductsSchema), async (req, res, next) => {
    try {
        const { page, limit, category, subcategory, search, sort, featured } = req.query;
        const where = {
            ...(typeof featured === "boolean" ? { isFeatured: featured } : {}),
        };
        if (category) {
            where.category = {
                slug: category,
            };
        }
        if (subcategory) {
            where.subcategory = {
                slug: subcategory,
            };
        }
        if (search) {
            where.OR = [
                { name: { contains: search, mode: "insensitive" } },
                { description: { contains: search, mode: "insensitive" } },
                { category: { name: { contains: search, mode: "insensitive" } } },
                { subcategory: { name: { contains: search, mode: "insensitive" } } },
            ];
        }
        const skip = (page - 1) * limit;
        const [total, products] = await Promise.all([
            prisma_1.prisma.product.count({ where }),
            prisma_1.prisma.product.findMany({
                where,
                skip,
                take: limit,
                orderBy: sortToOrderBy[sort],
                include: {
                    category: { select: { name: true, slug: true } },
                    subcategory: { select: { name: true, slug: true } },
                },
            }),
        ]);
        res.json({
            data: products.map(serializers_1.productToResponse),
            meta: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
            message: total === 0 && search ? `No match found for '${search}'` : undefined,
        });
    }
    catch (error) {
        next(error);
    }
});
router.get("/products/:productIdOrSlug", (0, validate_1.validate)(singleProductSchema), async (req, res, next) => {
    try {
        const { productIdOrSlug } = req.params;
        const product = await prisma_1.prisma.product.findFirst({
            where: {
                OR: [{ id: productIdOrSlug }, { slug: productIdOrSlug }],
            },
            include: {
                category: { select: { name: true, slug: true } },
                subcategory: { select: { name: true, slug: true } },
                reviews: {
                    include: {
                        user: { select: { firstName: true, lastName: true } },
                    },
                    orderBy: { createdAt: "desc" },
                },
            },
        });
        if (!product) {
            throw new appError_1.AppError("Product not found", 404);
        }
        res.json({
            ...(0, serializers_1.productToResponse)(product),
            reviews: product.reviews,
        });
    }
    catch (error) {
        next(error);
    }
});
exports.default = router;
