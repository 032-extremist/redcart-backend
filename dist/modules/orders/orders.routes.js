"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../../middleware/auth");
const csrf_1 = require("../../middleware/csrf");
const validate_1 = require("../../middleware/validate");
const prisma_1 = require("../../lib/prisma");
const appError_1 = require("../../utils/appError");
const notifications_1 = require("../../utils/notifications");
const logger_1 = require("../../config/logger");
const mpesa_1 = require("../../lib/mpesa");
const receipts_service_1 = require("../receipts/receipts.service");
const router = (0, express_1.Router)();
const checkoutSchema = zod_1.z.object({
    body: zod_1.z.object({
        paymentMethod: zod_1.z.nativeEnum(client_1.PaymentMethod),
        shippingName: zod_1.z.string().min(2),
        shippingPhone: zod_1.z.string().min(7),
        shippingEmail: zod_1.z.string().email(),
        shippingStreet: zod_1.z.string().min(3),
        shippingCity: zod_1.z.string().min(2),
        shippingCountry: zod_1.z.string().min(2),
        mpesaPayerName: zod_1.z.string().min(2).max(120).optional(),
    }),
    query: zod_1.z.object({}),
    params: zod_1.z.object({}),
});
const orderIdSchema = zod_1.z.object({
    body: zod_1.z.object({}),
    query: zod_1.z.object({}),
    params: zod_1.z.object({ orderId: zod_1.z.string().min(1) }),
});
const toJsonRecord = (value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        return value;
    }
    return {};
};
const mergeMpesaMeta = (current, patch) => {
    const existing = toJsonRecord(current);
    const currentMpesa = toJsonRecord(existing.mpesa);
    return {
        ...existing,
        mpesa: {
            ...currentMpesa,
            ...patch,
        },
    };
};
const sendOrderConfirmationEmailSafely = async (input) => {
    try {
        await (0, notifications_1.sendOrderConfirmationEmail)(input);
    }
    catch (error) {
        logger_1.logger.error({
            error,
            orderId: input.orderId,
            email: input.email,
        }, "Failed to send order confirmation email during order reconciliation");
    }
};
const ensureReceiptSafely = async (paymentId) => {
    try {
        await (0, receipts_service_1.ensureReceiptForSuccessfulPayment)(paymentId);
    }
    catch (error) {
        logger_1.logger.error({
            error,
            paymentId,
        }, "Failed to ensure receipt during order reconciliation");
    }
};
const reconcilePendingMpesaPaymentsForUser = async (userId) => {
    const pendingPayments = await prisma_1.prisma.payment.findMany({
        where: {
            provider: "MPESA",
            status: client_1.PaymentStatus.PENDING,
            order: {
                userId,
            },
        },
        include: {
            order: {
                select: {
                    id: true,
                    shippingName: true,
                    shippingEmail: true,
                    total: true,
                },
            },
        },
    });
    for (const payment of pendingPayments) {
        const mpesaMeta = toJsonRecord(toJsonRecord(payment.meta).mpesa);
        const checkoutRequestId = typeof mpesaMeta.checkoutRequestId === "string" && mpesaMeta.checkoutRequestId.trim().length > 0
            ? mpesaMeta.checkoutRequestId.trim()
            : null;
        if (!checkoutRequestId) {
            continue;
        }
        try {
            const query = await (0, mpesa_1.queryMpesaStkPushStatus)({ checkoutRequestId });
            const queryPatch = {
                lastStatusQueryAt: new Date().toISOString(),
                statusQuerySource: "ORDERS_LIST",
                queryResponseCode: query.responseCode,
                queryResponseDescription: query.responseDescription,
                queryMerchantRequestId: query.merchantRequestId || null,
                queryCheckoutRequestId: query.checkoutRequestId,
                queryResultCode: query.resultCode,
                queryResultDesc: query.resultDesc,
                queryRaw: query.raw,
            };
            if (query.resultCode === 0) {
                const receiptNumber = query.mpesaReceiptNumber || payment.transactionRef || query.checkoutRequestId;
                await prisma_1.prisma.$transaction(async (tx) => {
                    await tx.payment.update({
                        where: { id: payment.id },
                        data: {
                            status: client_1.PaymentStatus.SUCCESS,
                            transactionRef: receiptNumber,
                            meta: mergeMpesaMeta(payment.meta, {
                                ...queryPatch,
                                status: "SUCCESS",
                                resultCode: 0,
                                resultDesc: query.resultDesc ?? "Payment successful",
                                mpesaReceiptNumber: query.mpesaReceiptNumber,
                                receiptNumber,
                            }),
                        },
                    });
                    await tx.order.update({
                        where: { id: payment.orderId },
                        data: { status: "CONFIRMED" },
                    });
                });
                await sendOrderConfirmationEmailSafely({
                    orderId: payment.orderId,
                    email: payment.order.shippingEmail,
                    name: payment.order.shippingName,
                    total: Number(payment.order.total),
                });
                await ensureReceiptSafely(payment.id);
            }
            else if (typeof query.resultCode === "number") {
                await prisma_1.prisma.$transaction(async (tx) => {
                    await tx.payment.update({
                        where: { id: payment.id },
                        data: {
                            status: client_1.PaymentStatus.FAILED,
                            transactionRef: payment.transactionRef || query.checkoutRequestId,
                            meta: mergeMpesaMeta(payment.meta, {
                                ...queryPatch,
                                status: "FAILED",
                                resultCode: query.resultCode,
                                resultDesc: query.resultDesc ?? "Payment failed",
                            }),
                        },
                    });
                    await tx.order.update({
                        where: { id: payment.orderId },
                        data: { status: "PENDING_PAYMENT" },
                    });
                });
            }
            else {
                await prisma_1.prisma.payment.update({
                    where: { id: payment.id },
                    data: {
                        meta: mergeMpesaMeta(payment.meta, {
                            ...queryPatch,
                            status: "PENDING",
                        }),
                    },
                });
            }
        }
        catch (error) {
            logger_1.logger.error({
                error,
                paymentId: payment.id,
                checkoutRequestId,
            }, "Failed to reconcile pending M-Pesa payment from orders route");
        }
    }
};
router.use(auth_1.authenticate);
router.post("/checkout", csrf_1.requireCsrf, (0, validate_1.validate)(checkoutSchema), async (req, res, next) => {
    try {
        const userId = req.auth.userId;
        const { paymentMethod, shippingName, shippingPhone, shippingEmail, shippingStreet, shippingCity, shippingCountry, mpesaPayerName, } = req.body;
        const cart = await prisma_1.prisma.cart.findUnique({
            where: { userId },
            include: {
                items: {
                    include: {
                        product: true,
                    },
                },
            },
        });
        if (!cart || cart.items.length === 0) {
            throw new appError_1.AppError("Cart is empty", 400);
        }
        for (const item of cart.items) {
            if (item.quantity > item.product.stock) {
                throw new appError_1.AppError(`Insufficient stock for ${item.product.name}`, 400);
            }
        }
        if (paymentMethod === client_1.PaymentMethod.MPESA && !mpesaPayerName?.trim()) {
            throw new appError_1.AppError("M-Pesa payer name is required for receipt issuance", 422);
        }
        const total = Number(cart.items.reduce((sum, item) => sum + Number(item.product.price) * item.quantity, 0).toFixed(2));
        const created = await prisma_1.prisma.$transaction(async (tx) => {
            const order = await tx.order.create({
                data: {
                    userId,
                    paymentMethod,
                    total,
                    shippingName,
                    shippingPhone,
                    shippingEmail,
                    shippingStreet,
                    shippingCity,
                    shippingCountry,
                    status: paymentMethod === client_1.PaymentMethod.CARD ? "CONFIRMED" : "PENDING_PAYMENT",
                    items: {
                        create: cart.items.map((item) => {
                            const unitPrice = Number(item.product.price);
                            return {
                                productId: item.productId,
                                quantity: item.quantity,
                                unitPrice,
                                subtotal: Number((unitPrice * item.quantity).toFixed(2)),
                            };
                        }),
                    },
                    payment: {
                        create: {
                            provider: paymentMethod === client_1.PaymentMethod.CARD ? client_1.PaymentProvider.CARD : client_1.PaymentProvider.MPESA,
                            status: paymentMethod === client_1.PaymentMethod.CARD ? client_1.PaymentStatus.SUCCESS : client_1.PaymentStatus.PENDING,
                            amount: total,
                            transactionRef: paymentMethod === client_1.PaymentMethod.CARD
                                ? `CARD-${Date.now()}-${Math.floor(Math.random() * 1000)}`
                                : null,
                            meta: paymentMethod === client_1.PaymentMethod.MPESA
                                ? {
                                    mpesa: {
                                        requestedPayerName: mpesaPayerName ?? shippingName,
                                    },
                                }
                                : undefined,
                        },
                    },
                },
                include: {
                    payment: true,
                    items: true,
                },
            });
            for (const item of cart.items) {
                await tx.product.update({
                    where: { id: item.productId },
                    data: { stock: { decrement: item.quantity } },
                });
                await tx.productStockLog.create({
                    data: {
                        productId: item.productId,
                        delta: -item.quantity,
                        reason: `Order ${order.id}`,
                    },
                });
            }
            await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
            return order;
        });
        if (paymentMethod === client_1.PaymentMethod.CARD) {
            await (0, notifications_1.sendOrderConfirmationEmail)({
                orderId: created.id,
                email: shippingEmail,
                name: shippingName,
                total: Number(created.total),
            });
            await (0, receipts_service_1.ensureReceiptForSuccessfulPayment)(created.payment.id);
        }
        res.status(201).json({
            orderId: created.id,
            status: created.status,
            payment: {
                id: created.payment.id,
                provider: created.payment.provider,
                status: created.payment.status,
                amount: Number(created.payment.amount),
                transactionRef: created.payment.transactionRef,
            },
            total: Number(created.total),
            nextAction: paymentMethod === client_1.PaymentMethod.MPESA
                ? "Call POST /payments/mpesa/stk-push with paymentId and phoneNumber to trigger real STK push"
                : "Order confirmed",
        });
    }
    catch (error) {
        next(error);
    }
});
router.get("/", async (req, res, next) => {
    try {
        await reconcilePendingMpesaPaymentsForUser(req.auth.userId);
        const orders = await prisma_1.prisma.order.findMany({
            where: { userId: req.auth.userId },
            include: {
                items: {
                    include: {
                        product: {
                            select: {
                                id: true,
                                name: true,
                                slug: true,
                                imageUrl: true,
                            },
                        },
                    },
                },
                payment: true,
            },
            orderBy: { createdAt: "desc" },
        });
        const response = orders.map((order) => ({
            ...order,
            total: Number(order.total),
            payment: order.payment
                ? {
                    ...order.payment,
                    amount: Number(order.payment.amount),
                }
                : null,
            items: order.items.map((item) => ({
                ...item,
                unitPrice: Number(item.unitPrice),
                subtotal: Number(item.subtotal),
            })),
        }));
        res.json(response);
    }
    catch (error) {
        next(error);
    }
});
router.get("/:orderId/status", (0, validate_1.validate)(orderIdSchema), async (req, res, next) => {
    try {
        await reconcilePendingMpesaPaymentsForUser(req.auth.userId);
        const order = await prisma_1.prisma.order.findFirst({
            where: {
                id: req.params.orderId,
                userId: req.auth.userId,
            },
            include: { payment: true },
        });
        if (!order) {
            throw new appError_1.AppError("Order not found", 404);
        }
        res.json({
            id: order.id,
            status: order.status,
            total: Number(order.total),
            payment: order.payment
                ? {
                    status: order.payment.status,
                    provider: order.payment.provider,
                    transactionRef: order.payment.transactionRef,
                }
                : null,
            updatedAt: order.updatedAt,
        });
    }
    catch (error) {
        next(error);
    }
});
exports.default = router;
