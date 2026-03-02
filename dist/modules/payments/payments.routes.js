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
const env_1 = require("../../config/env");
const logger_1 = require("../../config/logger");
const mpesa_1 = require("../../lib/mpesa");
const receipts_service_1 = require("../receipts/receipts.service");
const router = (0, express_1.Router)();
const callbackParamsSchema = zod_1.z.object({
    body: zod_1.z.any(),
    query: zod_1.z.object({}),
    params: zod_1.z.object({ paymentId: zod_1.z.string().min(1) }),
});
const phoneNumberSchema = zod_1.z
    .string({ required_error: "Phone number is required" })
    .trim()
    .min(1, "Phone number is required")
    .refine((value) => value.replace(/\D/g, "").length >= 10, "Phone number must be at least 10 digits.");
const stkPushSchema = zod_1.z.object({
    body: zod_1.z.object({
        paymentId: zod_1.z.string().min(1, "Payment ID is required"),
        phoneNumber: phoneNumberSchema,
    }),
    query: zod_1.z.object({}),
    params: zod_1.z.object({}),
});
const paymentStatusSchema = zod_1.z.object({
    body: zod_1.z.object({}),
    query: zod_1.z.object({}),
    params: zod_1.z.object({ paymentId: zod_1.z.string().min(1) }),
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
const normalizeBaseUrl = (value) => value.trim().replace(/\/+$/, "");
const isHostedRuntime = env_1.env.NODE_ENV === "production" ||
    process.env.RENDER === "true" ||
    Boolean(process.env.RAILWAY_ENVIRONMENT ||
        process.env.RAILWAY_ENVIRONMENT_ID ||
        process.env.RAILWAY_PROJECT_ID ||
        process.env.FLY_APP_NAME);
const resolveRequestBaseUrl = (req) => {
    const forwardedProto = req
        .header("x-forwarded-proto")
        ?.split(",")[0]
        ?.trim();
    const forwardedHost = req
        .header("x-forwarded-host")
        ?.split(",")[0]
        ?.trim();
    const host = forwardedHost || req.get("host");
    if (!host) {
        throw new appError_1.AppError("Unable to resolve callback host", 500);
    }
    const protocol = forwardedProto || req.protocol || "https";
    return normalizeBaseUrl(`${protocol}://${host}`);
};
const buildMpesaCallbackUrl = (paymentId, req) => {
    const configuredBase = env_1.env.MPESA_CALLBACK_BASE_URL ? normalizeBaseUrl(env_1.env.MPESA_CALLBACK_BASE_URL) : null;
    const base = isHostedRuntime ? resolveRequestBaseUrl(req) : configuredBase || resolveRequestBaseUrl(req);
    const hasApiV1Suffix = /\/api\/v1$/i.test(base);
    if (hasApiV1Suffix) {
        return `${base}/payments/mpesa/callback/${paymentId}`;
    }
    return `${base}/api/v1/payments/mpesa/callback/${paymentId}`;
};
const getMpesaMeta = (meta) => {
    const existing = toJsonRecord(meta);
    return toJsonRecord(existing.mpesa);
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
        }, "Failed to send order confirmation email after payment success");
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
        }, "Failed to ensure receipt after payment success");
    }
};
const findUserMpesaPayment = (paymentId, userId) => prisma_1.prisma.payment.findFirst({
    where: {
        id: paymentId,
        provider: "MPESA",
        order: {
            userId,
        },
    },
    include: {
        order: true,
    },
});
const reconcilePendingMpesaPayment = async (paymentId, userId) => {
    const payment = await findUserMpesaPayment(paymentId, userId);
    if (!payment) {
        throw new appError_1.AppError("Payment not found", 404);
    }
    if (payment.status !== client_1.PaymentStatus.PENDING) {
        return payment;
    }
    const mpesaMeta = getMpesaMeta(payment.meta);
    const checkoutRequestId = typeof mpesaMeta.checkoutRequestId === "string" && mpesaMeta.checkoutRequestId.trim().length > 0
        ? mpesaMeta.checkoutRequestId.trim()
        : null;
    if (!checkoutRequestId) {
        return payment;
    }
    try {
        const query = await (0, mpesa_1.queryMpesaStkPushStatus)({ checkoutRequestId });
        const queryPatch = {
            lastStatusQueryAt: new Date().toISOString(),
            statusQuerySource: "STK_QUERY",
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
        const statusQueryErrorMessage = error instanceof appError_1.AppError
            ? error.message
            : error instanceof Error
                ? error.message
                : "Unknown M-Pesa status query error";
        const statusQueryErrorCode = error instanceof appError_1.AppError ? error.statusCode : null;
        await prisma_1.prisma.payment
            .update({
            where: { id: payment.id },
            data: {
                meta: mergeMpesaMeta(payment.meta, {
                    lastStatusQueryAt: new Date().toISOString(),
                    statusQuerySource: "PAYMENT_STATUS",
                    statusQueryError: statusQueryErrorMessage,
                    statusQueryErrorCode,
                }),
            },
        })
            .catch(() => undefined);
        logger_1.logger.error({
            paymentId: payment.id,
            checkoutRequestId,
            errorName: error instanceof Error ? error.name : typeof error,
            errorMessage: statusQueryErrorMessage,
            errorStatusCode: statusQueryErrorCode,
        }, "Failed to reconcile pending M-Pesa payment via STK query");
    }
    const refreshed = await findUserMpesaPayment(paymentId, userId);
    if (!refreshed) {
        throw new appError_1.AppError("Payment not found", 404);
    }
    return refreshed;
};
router.post("/mpesa/callback/:paymentId", (0, validate_1.validate)(callbackParamsSchema), async (req, res, next) => {
    try {
        const { paymentId } = req.params;
        const payment = await prisma_1.prisma.payment.findUnique({
            where: { id: paymentId },
            include: { order: true },
        });
        if (!payment) {
            throw new appError_1.AppError("Payment not found", 404);
        }
        const stkCallback = req.body?.Body?.stkCallback;
        if (!stkCallback) {
            throw new appError_1.AppError("Invalid M-Pesa callback payload", 400);
        }
        const callbackItems = Array.isArray(stkCallback?.CallbackMetadata?.Item)
            ? stkCallback.CallbackMetadata.Item
            : [];
        const findCallbackValue = (name) => callbackItems.find((item) => item?.Name === name)?.Value;
        const resultCode = Number(stkCallback.ResultCode ?? -1);
        const merchantRequestId = String(stkCallback.MerchantRequestID ?? "");
        const checkoutRequestId = String(stkCallback.CheckoutRequestID ?? "");
        const resultDesc = String(stkCallback.ResultDesc ?? "");
        const callbackFirstName = String(findCallbackValue("FirstName") ?? "").trim();
        const callbackMiddleName = String(findCallbackValue("MiddleName") ?? "").trim();
        const callbackLastName = String(findCallbackValue("LastName") ?? "").trim();
        const callbackPhoneNumber = String(findCallbackValue("PhoneNumber") ?? "").trim();
        if (resultCode === 0) {
            if (payment.status !== client_1.PaymentStatus.SUCCESS) {
                const receiptNumber = String(findCallbackValue("MpesaReceiptNumber") ?? checkoutRequestId);
                await prisma_1.prisma.$transaction(async (tx) => {
                    await tx.payment.update({
                        where: { id: payment.id },
                        data: {
                            status: client_1.PaymentStatus.SUCCESS,
                            transactionRef: receiptNumber,
                            meta: mergeMpesaMeta(payment.meta, {
                                status: "SUCCESS",
                                callbackReceivedAt: new Date().toISOString(),
                                resultCode,
                                resultDesc,
                                merchantRequestId,
                                checkoutRequestId,
                                amount: findCallbackValue("Amount") ?? Number(payment.amount),
                                callbackPhoneNumber: callbackPhoneNumber || null,
                                transactionDate: findCallbackValue("TransactionDate") ?? null,
                                receiptNumber,
                                callbackFirstName: callbackFirstName || null,
                                callbackMiddleName: callbackMiddleName || null,
                                callbackLastName: callbackLastName || null,
                                rawCallback: req.body,
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
            return res.json({
                message: "M-Pesa callback processed",
                resultCode,
            });
        }
        if (payment.status !== client_1.PaymentStatus.SUCCESS) {
            await prisma_1.prisma.$transaction(async (tx) => {
                await tx.payment.update({
                    where: { id: payment.id },
                    data: {
                        status: client_1.PaymentStatus.FAILED,
                        transactionRef: checkoutRequestId || payment.transactionRef,
                        meta: mergeMpesaMeta(payment.meta, {
                            status: "FAILED",
                            callbackReceivedAt: new Date().toISOString(),
                            resultCode,
                            resultDesc,
                            merchantRequestId,
                            checkoutRequestId,
                            rawCallback: req.body,
                        }),
                    },
                });
                await tx.order.update({
                    where: { id: payment.orderId },
                    data: { status: "PENDING_PAYMENT" },
                });
            });
        }
        return res.json({
            message: "M-Pesa callback processed",
            resultCode,
        });
    }
    catch (error) {
        next(error);
    }
});
router.use(auth_1.authenticate);
router.post("/mpesa/stk-push", csrf_1.requireCsrf, (0, validate_1.validate)(stkPushSchema), async (req, res, next) => {
    try {
        const { paymentId, phoneNumber } = req.body;
        const payment = await prisma_1.prisma.payment.findFirst({
            where: {
                id: paymentId,
                provider: "MPESA",
                order: {
                    userId: req.auth.userId,
                },
            },
            include: {
                order: true,
            },
        });
        if (!payment) {
            throw new appError_1.AppError("Payment not found", 404);
        }
        if (payment.status === client_1.PaymentStatus.SUCCESS) {
            return res.json({
                message: "Payment already completed",
                payment: {
                    id: payment.id,
                    status: payment.status,
                    transactionRef: payment.transactionRef,
                },
            });
        }
        const normalizedPhone = (0, mpesa_1.normalizeKenyanPhoneNumber)(phoneNumber);
        const callbackUrl = buildMpesaCallbackUrl(payment.id, req);
        logger_1.logger.info({
            type: "mpesa_stk_initiation_attempt",
            paymentId: payment.id,
            orderId: payment.orderId,
            userId: req.auth.userId,
            env: env_1.env.MPESA_ENV,
            shortCode: env_1.env.MPESA_SHORTCODE,
            callbackUrl,
            normalizedPhone,
        }, "Initiating M-Pesa STK push");
        const stkResult = await (0, mpesa_1.initiateMpesaStkPush)({
            amount: Number(payment.amount),
            phoneNumber: normalizedPhone,
            callbackUrl,
            reference: `RedCart-${payment.orderId.slice(-8)}`,
            description: `Payment for order ${payment.orderId.slice(-8)}`,
        });
        await prisma_1.prisma.payment.update({
            where: { id: payment.id },
            data: {
                status: client_1.PaymentStatus.PENDING,
                meta: mergeMpesaMeta(payment.meta, {
                    status: "PENDING",
                    initiatedAt: new Date().toISOString(),
                    phoneNumber: normalizedPhone,
                    merchantRequestId: stkResult.merchantRequestId,
                    checkoutRequestId: stkResult.checkoutRequestId,
                    responseCode: stkResult.responseCode,
                    responseDescription: stkResult.responseDescription,
                    customerMessage: stkResult.customerMessage,
                    callbackUrl,
                }),
            },
        });
        res.json({
            message: stkResult.customerMessage || "STK push initiated",
            order: {
                id: payment.orderId,
                status: payment.order.status,
            },
            payment: {
                id: payment.id,
                status: client_1.PaymentStatus.PENDING,
                amount: Number(payment.amount),
            },
            mpesa: stkResult,
        });
    }
    catch (error) {
        logger_1.logger.error({
            type: "mpesa_stk_initiation_failed",
            paymentId: req.body?.paymentId,
            userId: req.auth?.userId,
            errorName: error instanceof Error ? error.name : typeof error,
            errorMessage: error instanceof Error ? error.message : String(error),
        }, "M-Pesa STK initiation failed");
        next(error);
    }
});
router.get("/mpesa/:paymentId/status", (0, validate_1.validate)(paymentStatusSchema), async (req, res, next) => {
    try {
        const payment = await reconcilePendingMpesaPayment(req.params.paymentId, req.auth.userId);
        await ensureReceiptSafely(payment.id);
        res.json({
            id: payment.id,
            status: payment.status,
            amount: Number(payment.amount),
            transactionRef: payment.transactionRef,
            order: {
                id: payment.order.id,
                status: payment.order.status,
            },
            meta: payment.meta,
        });
    }
    catch (error) {
        next(error);
    }
});
exports.default = router;
