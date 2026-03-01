import { PaymentMethod, PaymentProvider, PaymentStatus, Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth";
import { requireCsrf } from "../../middleware/csrf";
import { validate } from "../../middleware/validate";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/appError";
import { sendOrderConfirmationEmail } from "../../utils/notifications";
import { logger } from "../../config/logger";
import { queryMpesaStkPushStatus } from "../../lib/mpesa";
import { ensureReceiptForSuccessfulPayment } from "../receipts/receipts.service";

const router = Router();

const checkoutSchema = z.object({
  body: z.object({
    paymentMethod: z.nativeEnum(PaymentMethod),
    shippingName: z.string().min(2),
    shippingPhone: z.string().min(7),
    shippingEmail: z.string().email(),
    shippingStreet: z.string().min(3),
    shippingCity: z.string().min(2),
    shippingCountry: z.string().min(2),
    mpesaPayerName: z.string().min(2).max(120).optional(),
  }),
  query: z.object({}),
  params: z.object({}),
});

const orderIdSchema = z.object({
  body: z.object({}),
  query: z.object({}),
  params: z.object({ orderId: z.string().min(1) }),
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
      "Failed to send order confirmation email during order reconciliation",
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
      "Failed to ensure receipt during order reconciliation",
    );
  }
};

const reconcilePendingMpesaPaymentsForUser = async (userId: string) => {
  const pendingPayments = await prisma.payment.findMany({
    where: {
      provider: "MPESA",
      status: PaymentStatus.PENDING,
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
    const checkoutRequestId =
      typeof mpesaMeta.checkoutRequestId === "string" && mpesaMeta.checkoutRequestId.trim().length > 0
        ? mpesaMeta.checkoutRequestId.trim()
        : null;

    if (!checkoutRequestId) {
      continue;
    }

    try {
      const query = await queryMpesaStkPushStatus({ checkoutRequestId });
      const queryPatch: JsonRecord = {
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
        "Failed to reconcile pending M-Pesa payment from orders route",
      );
    }
  }
};

router.use(authenticate);

router.post("/checkout", requireCsrf, validate(checkoutSchema), async (req, res, next) => {
  try {
    const userId = req.auth!.userId;
    const {
      paymentMethod,
      shippingName,
      shippingPhone,
      shippingEmail,
      shippingStreet,
      shippingCity,
      shippingCountry,
      mpesaPayerName,
    } = req.body;

    const cart = await prisma.cart.findUnique({
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
      throw new AppError("Cart is empty", 400);
    }

    for (const item of cart.items) {
      if (item.quantity > item.product.stock) {
        throw new AppError(`Insufficient stock for ${item.product.name}`, 400);
      }
    }

    if (paymentMethod === PaymentMethod.MPESA && !mpesaPayerName?.trim()) {
      throw new AppError("M-Pesa payer name is required for receipt issuance", 422);
    }

    const total = Number(
      cart.items.reduce((sum, item) => sum + Number(item.product.price) * item.quantity, 0).toFixed(2),
    );

    const created = await prisma.$transaction(async (tx) => {
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
          status: paymentMethod === PaymentMethod.CARD ? "CONFIRMED" : "PENDING_PAYMENT",
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
              provider: paymentMethod === PaymentMethod.CARD ? PaymentProvider.CARD : PaymentProvider.MPESA,
              status: paymentMethod === PaymentMethod.CARD ? PaymentStatus.SUCCESS : PaymentStatus.PENDING,
              amount: total,
              transactionRef:
                paymentMethod === PaymentMethod.CARD
                  ? `CARD-${Date.now()}-${Math.floor(Math.random() * 1000)}`
                  : null,
              meta:
                paymentMethod === PaymentMethod.MPESA
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

    if (paymentMethod === PaymentMethod.CARD) {
      await sendOrderConfirmationEmail({
        orderId: created.id,
        email: shippingEmail,
        name: shippingName,
        total: Number(created.total),
      });

      await ensureReceiptForSuccessfulPayment(created.payment!.id);
    }

    res.status(201).json({
      orderId: created.id,
      status: created.status,
      payment: {
        id: created.payment!.id,
        provider: created.payment!.provider,
        status: created.payment!.status,
        amount: Number(created.payment!.amount),
        transactionRef: created.payment!.transactionRef,
      },
      total: Number(created.total),
      nextAction:
        paymentMethod === PaymentMethod.MPESA
          ? "Call POST /payments/mpesa/stk-push with paymentId and phoneNumber to trigger real STK push"
          : "Order confirmed",
    });
  } catch (error) {
    next(error);
  }
});

router.get("/", async (req, res, next) => {
  try {
    await reconcilePendingMpesaPaymentsForUser(req.auth!.userId);

    const orders = await prisma.order.findMany({
      where: { userId: req.auth!.userId },
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
  } catch (error) {
    next(error);
  }
});

router.get("/:orderId/status", validate(orderIdSchema), async (req, res, next) => {
  try {
    await reconcilePendingMpesaPaymentsForUser(req.auth!.userId);

    const order = await prisma.order.findFirst({
      where: {
        id: req.params.orderId,
        userId: req.auth!.userId,
      },
      include: { payment: true },
    });

    if (!order) {
      throw new AppError("Order not found", 404);
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
  } catch (error) {
    next(error);
  }
});

export default router;
