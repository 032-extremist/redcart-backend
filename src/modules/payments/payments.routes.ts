import { PaymentStatus, Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth";
import { requireCsrf } from "../../middleware/csrf";
import { validate } from "../../middleware/validate";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/appError";
import { sendOrderConfirmationEmail } from "../../utils/notifications";
import { env } from "../../config/env";
import { logger } from "../../config/logger";
import {
  initiateMpesaStkPush,
  normalizeKenyanPhoneNumber,
  queryMpesaStkPushStatus,
} from "../../lib/mpesa";
import { ensureReceiptForSuccessfulPayment } from "../receipts/receipts.service";

const router = Router();

const callbackParamsSchema = z.object({
  body: z.any(),
  query: z.object({}),
  params: z.object({ paymentId: z.string().min(1) }),
});

const stkPushSchema = z.object({
  body: z.object({
    paymentId: z.string().min(1),
    phoneNumber: z.string().min(7),
  }),
  query: z.object({}),
  params: z.object({}),
});

const paymentStatusSchema = z.object({
  body: z.object({}),
  query: z.object({}),
  params: z.object({ paymentId: z.string().min(1) }),
});

type JsonRecord = Record<string, unknown>;

const toJsonRecord = (value: unknown): JsonRecord => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonRecord;
  }

  return {};
};

const mergeMpesaMeta = (current: unknown, patch: JsonRecord): Prisma.InputJsonValue => {
  const existing = toJsonRecord(current);
  const currentMpesa = toJsonRecord(existing.mpesa);

  return {
    ...existing,
    mpesa: {
      ...currentMpesa,
      ...patch,
    },
  } as Prisma.InputJsonValue;
};

const buildMpesaCallbackUrl = (paymentId: string) => {
  const base = env.MPESA_CALLBACK_BASE_URL!.replace(/\/+$/, "");
  const hasApiV1Suffix = /\/api\/v1$/i.test(base);

  if (hasApiV1Suffix) {
    return `${base}/payments/mpesa/callback/${paymentId}`;
  }

  return `${base}/api/v1/payments/mpesa/callback/${paymentId}`;
};

const getMpesaMeta = (meta: unknown) => {
  const existing = toJsonRecord(meta);
  return toJsonRecord(existing.mpesa);
};

const sendOrderConfirmationEmailSafely = async (input: {
  orderId: string;
  email: string;
  name: string;
  total: number;
}) => {
  try {
    await sendOrderConfirmationEmail(input);
  } catch (error) {
    logger.error(
      {
        error,
        orderId: input.orderId,
        email: input.email,
      },
      "Failed to send order confirmation email after payment success",
    );
  }
};

const ensureReceiptSafely = async (paymentId: string) => {
  try {
    await ensureReceiptForSuccessfulPayment(paymentId);
  } catch (error) {
    logger.error(
      {
        error,
        paymentId,
      },
      "Failed to ensure receipt after payment success",
    );
  }
};

const findUserMpesaPayment = (paymentId: string, userId: string) =>
  prisma.payment.findFirst({
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

const reconcilePendingMpesaPayment = async (paymentId: string, userId: string) => {
  const payment = await findUserMpesaPayment(paymentId, userId);
  if (!payment) {
    throw new AppError("Payment not found", 404);
  }

  if (payment.status !== PaymentStatus.PENDING) {
    return payment;
  }

  const mpesaMeta = getMpesaMeta(payment.meta);
  const checkoutRequestId =
    typeof mpesaMeta.checkoutRequestId === "string" && mpesaMeta.checkoutRequestId.trim().length > 0
      ? mpesaMeta.checkoutRequestId.trim()
      : null;

  if (!checkoutRequestId) {
    return payment;
  }

  try {
    const query = await queryMpesaStkPushStatus({ checkoutRequestId });
    const queryPatch: JsonRecord = {
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

      await prisma.$transaction(async (tx) => {
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.SUCCESS,
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
    } else if (typeof query.resultCode === "number") {
      await prisma.$transaction(async (tx) => {
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.FAILED,
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
    } else {
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          meta: mergeMpesaMeta(payment.meta, {
            ...queryPatch,
            status: "PENDING",
          }),
        },
      });
    }
  } catch (error) {
    logger.error(
      {
        error,
        paymentId: payment.id,
        checkoutRequestId,
      },
      "Failed to reconcile pending M-Pesa payment via STK query",
    );
  }

  const refreshed = await findUserMpesaPayment(paymentId, userId);
  if (!refreshed) {
    throw new AppError("Payment not found", 404);
  }

  return refreshed;
};

router.post("/mpesa/callback/:paymentId", validate(callbackParamsSchema), async (req, res, next) => {
  try {
    const { paymentId } = req.params;

    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { order: true },
    });

    if (!payment) {
      throw new AppError("Payment not found", 404);
    }

    const stkCallback = req.body?.Body?.stkCallback;
    if (!stkCallback) {
      throw new AppError("Invalid M-Pesa callback payload", 400);
    }

    const callbackItems = Array.isArray(stkCallback?.CallbackMetadata?.Item)
      ? stkCallback.CallbackMetadata.Item
      : [];

    const findCallbackValue = (name: string) => callbackItems.find((item: any) => item?.Name === name)?.Value;

    const resultCode = Number(stkCallback.ResultCode ?? -1);
    const merchantRequestId = String(stkCallback.MerchantRequestID ?? "");
    const checkoutRequestId = String(stkCallback.CheckoutRequestID ?? "");
    const resultDesc = String(stkCallback.ResultDesc ?? "");
    const callbackFirstName = String(findCallbackValue("FirstName") ?? "").trim();
    const callbackMiddleName = String(findCallbackValue("MiddleName") ?? "").trim();
    const callbackLastName = String(findCallbackValue("LastName") ?? "").trim();
    const callbackPhoneNumber = String(findCallbackValue("PhoneNumber") ?? "").trim();

    if (resultCode === 0) {
      if (payment.status !== PaymentStatus.SUCCESS) {
        const receiptNumber = String(findCallbackValue("MpesaReceiptNumber") ?? checkoutRequestId);

        await prisma.$transaction(async (tx) => {
          await tx.payment.update({
            where: { id: payment.id },
            data: {
              status: PaymentStatus.SUCCESS,
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

    if (payment.status !== PaymentStatus.SUCCESS) {
      await prisma.$transaction(async (tx) => {
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.FAILED,
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
  } catch (error) {
    next(error);
  }
});

router.use(authenticate);

router.post("/mpesa/stk-push", requireCsrf, validate(stkPushSchema), async (req, res, next) => {
  try {
    const { paymentId, phoneNumber } = req.body;

    const payment = await prisma.payment.findFirst({
      where: {
        id: paymentId,
        provider: "MPESA",
        order: {
          userId: req.auth!.userId,
        },
      },
      include: {
        order: true,
      },
    });

    if (!payment) {
      throw new AppError("Payment not found", 404);
    }

    if (payment.status === PaymentStatus.SUCCESS) {
      return res.json({
        message: "Payment already completed",
        payment: {
          id: payment.id,
          status: payment.status,
          transactionRef: payment.transactionRef,
        },
      });
    }

    const normalizedPhone = normalizeKenyanPhoneNumber(phoneNumber);
    const callbackUrl = buildMpesaCallbackUrl(payment.id);

    const stkResult = await initiateMpesaStkPush({
      amount: Number(payment.amount),
      phoneNumber: normalizedPhone,
      callbackUrl,
      reference: `RedCart-${payment.orderId.slice(-8)}`,
      description: `Payment for order ${payment.orderId.slice(-8)}`,
    });

    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.PENDING,
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
        status: PaymentStatus.PENDING,
        amount: Number(payment.amount),
      },
      mpesa: stkResult,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/mpesa/:paymentId/status", validate(paymentStatusSchema), async (req, res, next) => {
  try {
    const payment = await reconcilePendingMpesaPayment(req.params.paymentId, req.auth!.userId);
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
  } catch (error) {
    next(error);
  }
});

export default router;
