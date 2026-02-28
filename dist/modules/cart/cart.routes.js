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
const addItemSchema = zod_1.z.object({
    body: zod_1.z.object({
        productId: zod_1.z.string().min(1),
        quantity: zod_1.z.number().int().min(1).max(50).default(1),
    }),
    query: zod_1.z.object({}),
    params: zod_1.z.object({}),
});
const updateItemSchema = zod_1.z.object({
    body: zod_1.z.object({
        quantity: zod_1.z.number().int().min(1).max(50),
    }),
    query: zod_1.z.object({}),
    params: zod_1.z.object({ itemId: zod_1.z.string().min(1) }),
});
const deleteItemSchema = zod_1.z.object({
    body: zod_1.z.object({}),
    query: zod_1.z.object({}),
    params: zod_1.z.object({ itemId: zod_1.z.string().min(1) }),
});
router.use(auth_1.authenticate);
const getCartResponse = async (userId) => {
    const cart = await prisma_1.prisma.cart.findUnique({
        where: { userId },
        include: {
            items: {
                include: {
                    product: {
                        include: {
                            category: { select: { name: true, slug: true } },
                            subcategory: { select: { name: true, slug: true } },
                        },
                    },
                },
                orderBy: { createdAt: "desc" },
            },
        },
    });
    if (!cart) {
        const created = await prisma_1.prisma.cart.create({
            data: { userId },
            include: {
                items: {
                    include: {
                        product: true,
                    },
                },
            },
        });
        return {
            id: created.id,
            items: [],
            subtotal: 0,
            total: 0,
        };
    }
    const items = cart.items.map((item) => {
        const unitPrice = Number(item.product.price);
        const subtotal = Number((unitPrice * item.quantity).toFixed(2));
        return {
            id: item.id,
            quantity: item.quantity,
            subtotal,
            product: {
                id: item.product.id,
                name: item.product.name,
                slug: item.product.slug,
                price: unitPrice,
                imageUrl: item.product.imageUrl,
                stock: item.product.stock,
                category: item.product.category,
                subcategory: item.product.subcategory,
            },
        };
    });
    const total = Number(items.reduce((sum, item) => sum + item.subtotal, 0).toFixed(2));
    return {
        id: cart.id,
        items,
        subtotal: total,
        total,
    };
};
router.get("/", async (req, res, next) => {
    try {
        const cart = await getCartResponse(req.auth.userId);
        res.json(cart);
    }
    catch (error) {
        next(error);
    }
});
router.post("/items", csrf_1.requireCsrf, (0, validate_1.validate)(addItemSchema), async (req, res, next) => {
    try {
        const { productId, quantity } = req.body;
        const userId = req.auth.userId;
        const product = await prisma_1.prisma.product.findUnique({ where: { id: productId } });
        if (!product) {
            throw new appError_1.AppError("Product not found", 404);
        }
        if (product.stock < quantity) {
            throw new appError_1.AppError("Insufficient stock", 400);
        }
        const cart = await prisma_1.prisma.cart.upsert({
            where: { userId },
            create: { userId },
            update: {},
        });
        const existingItem = await prisma_1.prisma.cartItem.findUnique({
            where: {
                cartId_productId: {
                    cartId: cart.id,
                    productId,
                },
            },
        });
        const nextQuantity = existingItem ? existingItem.quantity + quantity : quantity;
        if (nextQuantity > product.stock) {
            throw new appError_1.AppError("Requested quantity exceeds stock", 400);
        }
        await prisma_1.prisma.cartItem.upsert({
            where: {
                cartId_productId: {
                    cartId: cart.id,
                    productId,
                },
            },
            create: {
                cartId: cart.id,
                productId,
                quantity,
            },
            update: {
                quantity: nextQuantity,
            },
        });
        const response = await getCartResponse(userId);
        res.status(201).json(response);
    }
    catch (error) {
        next(error);
    }
});
router.patch("/items/:itemId", csrf_1.requireCsrf, (0, validate_1.validate)(updateItemSchema), async (req, res, next) => {
    try {
        const { itemId } = req.params;
        const { quantity } = req.body;
        const item = await prisma_1.prisma.cartItem.findFirst({
            where: {
                id: itemId,
                cart: {
                    userId: req.auth.userId,
                },
            },
            include: {
                product: true,
            },
        });
        if (!item) {
            throw new appError_1.AppError("Cart item not found", 404);
        }
        if (quantity > item.product.stock) {
            throw new appError_1.AppError("Requested quantity exceeds stock", 400);
        }
        await prisma_1.prisma.cartItem.update({
            where: { id: itemId },
            data: { quantity },
        });
        const response = await getCartResponse(req.auth.userId);
        res.json(response);
    }
    catch (error) {
        next(error);
    }
});
router.delete("/items/:itemId", csrf_1.requireCsrf, (0, validate_1.validate)(deleteItemSchema), async (req, res, next) => {
    try {
        const { itemId } = req.params;
        const item = await prisma_1.prisma.cartItem.findFirst({
            where: {
                id: itemId,
                cart: {
                    userId: req.auth.userId,
                },
            },
        });
        if (!item) {
            throw new appError_1.AppError("Cart item not found", 404);
        }
        await prisma_1.prisma.cartItem.delete({ where: { id: itemId } });
        const response = await getCartResponse(req.auth.userId);
        res.json(response);
    }
    catch (error) {
        next(error);
    }
});
exports.default = router;
