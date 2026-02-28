"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getReceiptByOrderForUser = exports.getReceiptByIdForUser = exports.ensureReceiptForSuccessfulPayment = void 0;
const client_1 = require("@prisma/client");
const prisma_1 = require("../../lib/prisma");
const appError_1 = require("../../utils/appError");
const toObject = (value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        return value;
    }
    return {};
};
const getMpesaMeta = (payment) => {
    const meta = toObject(payment.meta);
    return toObject(meta.mpesa);
};
const formatName = (parts) => parts
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(" ")
    .trim();
const resolvePayerIdentity = (payment) => {
    const mpesaMeta = getMpesaMeta(payment);
    const callbackRegistered = formatName([
        typeof mpesaMeta.callbackFirstName === "string" ? mpesaMeta.callbackFirstName : null,
        typeof mpesaMeta.callbackMiddleName === "string" ? mpesaMeta.callbackMiddleName : null,
        typeof mpesaMeta.callbackLastName === "string" ? mpesaMeta.callbackLastName : null,
    ]);
    const declaredName = typeof mpesaMeta.requestedPayerName === "string" && mpesaMeta.requestedPayerName.trim().length > 0
        ? mpesaMeta.requestedPayerName.trim()
        : null;
    const accountName = formatName([payment.order.user.firstName, payment.order.user.lastName]);
    const payerName = callbackRegistered || declaredName || payment.order.shippingName?.trim() || accountName || null;
    const payerNameSource = callbackRegistered
        ? client_1.PayerNameSource.CALLBACK_REGISTERED_NAME
        : declaredName
            ? client_1.PayerNameSource.CHECKOUT_DECLARED_NAME
            : payment.order.shippingName
                ? client_1.PayerNameSource.SHIPPING_NAME
                : accountName
                    ? client_1.PayerNameSource.ACCOUNT_NAME
                    : client_1.PayerNameSource.UNKNOWN;
    const payerPhone = (typeof mpesaMeta.callbackPhoneNumber === "string" ? mpesaMeta.callbackPhoneNumber : null) ||
        (typeof mpesaMeta.phoneNumber === "string" ? mpesaMeta.phoneNumber : null) ||
        payment.order.shippingPhone ||
        null;
    return {
        payerName,
        payerNameSource,
        payerPhone,
    };
};
const generateReceiptNumber = () => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const random = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
    return `RCT-${yyyy}${mm}${dd}-${random}`;
};
const getReceiptProjection = {
    id: true,
    receiptNumber: true,
    orderId: true,
    paymentId: true,
    payerPhone: true,
    payerName: true,
    payerNameSource: true,
    subtotal: true,
    tax: true,
    shippingFee: true,
    total: true,
    currency: true,
    itemsSnapshot: true,
    meta: true,
    issuedAt: true,
    createdAt: true,
    updatedAt: true,
};
const toResponse = (receipt) => ({
    ...receipt,
    subtotal: Number(receipt.subtotal),
    tax: Number(receipt.tax),
    shippingFee: Number(receipt.shippingFee),
    total: Number(receipt.total),
});
const getPaymentForReceipt = (client, paymentId) => client.payment.findUnique({
    where: { id: paymentId },
    include: {
        receipt: {
            select: getReceiptProjection,
        },
        order: {
            include: {
                user: {
                    select: {
                        firstName: true,
                        lastName: true,
                    },
                },
                items: {
                    include: {
                        product: {
                            select: {
                                id: true,
                                name: true,
                                slug: true,
                            },
                        },
                    },
                },
            },
        },
    },
});
const ensureReceiptForSuccessfulPayment = async (paymentId) => {
    const payment = (await getPaymentForReceipt(prisma_1.prisma, paymentId));
    if (!payment) {
        throw new appError_1.AppError("Payment not found", 404);
    }
    if (payment.status !== client_1.PaymentStatus.SUCCESS) {
        return null;
    }
    if (payment.receipt) {
        return toResponse(payment.receipt);
    }
    const identity = resolvePayerIdentity(payment);
    const itemsSnapshot = payment.order.items.map((item) => ({
        productId: item.product.id,
        productName: item.product.name,
        productSlug: item.product.slug,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
        subtotal: Number(item.subtotal),
    }));
    const subtotal = Number(itemsSnapshot.reduce((sum, item) => sum + item.subtotal, 0).toFixed(2));
    const total = Number(payment.order.total);
    const created = await prisma_1.prisma.$transaction(async (tx) => {
        const current = (await getPaymentForReceipt(tx, paymentId));
        if (!current) {
            throw new appError_1.AppError("Payment not found", 404);
        }
        if (current.receipt) {
            return current.receipt;
        }
        if (current.status !== client_1.PaymentStatus.SUCCESS) {
            throw new appError_1.AppError("Cannot issue receipt before successful payment", 400);
        }
        for (let attempts = 0; attempts < 5; attempts += 1) {
            const receiptNumber = generateReceiptNumber();
            try {
                const receipt = await tx.receipt.create({
                    data: {
                        receiptNumber,
                        orderId: current.order.id,
                        paymentId: current.id,
                        payerPhone: identity.payerPhone,
                        payerName: identity.payerName,
                        payerNameSource: identity.payerNameSource,
                        subtotal,
                        tax: 0,
                        shippingFee: 0,
                        total,
                        currency: "KES",
                        itemsSnapshot: itemsSnapshot,
                        meta: {
                            generatedAt: new Date().toISOString(),
                            paymentProvider: current.provider,
                            paymentTransactionRef: current.transactionRef,
                        },
                    },
                    select: {
                        id: true,
                    },
                });
                return tx.receipt.findUniqueOrThrow({
                    where: { id: receipt.id },
                    select: getReceiptProjection,
                });
            }
            catch (error) {
                if (error instanceof client_1.Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
                    continue;
                }
                throw error;
            }
        }
        throw new appError_1.AppError("Unable to generate unique receipt number", 500);
    });
    return toResponse(created);
};
exports.ensureReceiptForSuccessfulPayment = ensureReceiptForSuccessfulPayment;
const getReceiptByIdForUser = async (receiptId, userId) => {
    const receipt = await prisma_1.prisma.receipt.findFirst({
        where: {
            id: receiptId,
            order: {
                userId,
            },
        },
        include: {
            order: {
                select: {
                    id: true,
                    createdAt: true,
                    shippingName: true,
                    shippingEmail: true,
                    shippingPhone: true,
                    shippingStreet: true,
                    shippingCity: true,
                    shippingCountry: true,
                },
            },
            payment: {
                select: {
                    id: true,
                    provider: true,
                    status: true,
                    transactionRef: true,
                    createdAt: true,
                },
            },
        },
    });
    if (!receipt) {
        throw new appError_1.AppError("Receipt not found", 404);
    }
    return {
        ...receipt,
        subtotal: Number(receipt.subtotal),
        tax: Number(receipt.tax),
        shippingFee: Number(receipt.shippingFee),
        total: Number(receipt.total),
    };
};
exports.getReceiptByIdForUser = getReceiptByIdForUser;
const getReceiptByOrderForUser = async (orderId, userId) => {
    const receipt = await prisma_1.prisma.receipt.findFirst({
        where: {
            orderId,
            order: {
                userId,
            },
        },
        include: {
            order: {
                select: {
                    id: true,
                    createdAt: true,
                    shippingName: true,
                    shippingEmail: true,
                    shippingPhone: true,
                    shippingStreet: true,
                    shippingCity: true,
                    shippingCountry: true,
                },
            },
            payment: {
                select: {
                    id: true,
                    provider: true,
                    status: true,
                    transactionRef: true,
                    createdAt: true,
                },
            },
        },
    });
    if (!receipt) {
        throw new appError_1.AppError("Receipt not found", 404);
    }
    return {
        ...receipt,
        subtotal: Number(receipt.subtotal),
        tax: Number(receipt.tax),
        shippingFee: Number(receipt.shippingFee),
        total: Number(receipt.total),
    };
};
exports.getReceiptByOrderForUser = getReceiptByOrderForUser;
