import { PaymentMethod, PaymentProvider, PaymentStatus } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth";
import { requireCsrf } from "../../middleware/csrf";
import { validate } from "../../middleware/validate";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/appError";
import { sendOrderConfirmationEmail } from "../../utils/notifications";
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
