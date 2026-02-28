import { PayerNameSource, PaymentStatus, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/appError";

type JsonRecord = Record<string, unknown>;

type ReceiptContext = {
  id: string;
  provider: "MPESA" | "CARD";
  status: PaymentStatus;
  amount: Prisma.Decimal;
  transactionRef: string | null;
  meta: Prisma.JsonValue | null;
  order: {
    id: string;
    shippingName: string;
    shippingPhone: string;
    total: Prisma.Decimal;
    user: {
      firstName: string;
      lastName: string;
    };
    items: Array<{
      quantity: number;
      unitPrice: Prisma.Decimal;
      subtotal: Prisma.Decimal;
      product: {
        id: string;
        name: string;
        slug: string;
      };
    }>;
  };
  receipt?: {
    id: string;
    receiptNumber: string;
    orderId: string;
    paymentId: string;
    payerPhone: string | null;
    payerName: string | null;
    payerNameSource: PayerNameSource;
    subtotal: Prisma.Decimal;
    tax: Prisma.Decimal;
    shippingFee: Prisma.Decimal;
    total: Prisma.Decimal;
    currency: string;
    itemsSnapshot: Prisma.JsonValue;
    meta: Prisma.JsonValue | null;
    issuedAt: Date;
    createdAt: Date;
    updatedAt: Date;
  } | null;
};

const toObject = (value: unknown): JsonRecord => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonRecord;
  }

  return {};
};

const getMpesaMeta = (payment: ReceiptContext) => {
  const meta = toObject(payment.meta);
  return toObject(meta.mpesa);
};

const formatName = (parts: Array<string | null | undefined>) =>
  parts
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(" ")
    .trim();

const resolvePayerIdentity = (
  payment: ReceiptContext,
): { payerName: string | null; payerNameSource: PayerNameSource; payerPhone: string | null } => {
  const mpesaMeta = getMpesaMeta(payment);

  const callbackRegistered = formatName([
    typeof mpesaMeta.callbackFirstName === "string" ? mpesaMeta.callbackFirstName : null,
    typeof mpesaMeta.callbackMiddleName === "string" ? mpesaMeta.callbackMiddleName : null,
    typeof mpesaMeta.callbackLastName === "string" ? mpesaMeta.callbackLastName : null,
  ]);

  const declaredName =
    typeof mpesaMeta.requestedPayerName === "string" && mpesaMeta.requestedPayerName.trim().length > 0
      ? mpesaMeta.requestedPayerName.trim()
      : null;

  const accountName = formatName([payment.order.user.firstName, payment.order.user.lastName]);

  const payerName = callbackRegistered || declaredName || payment.order.shippingName?.trim() || accountName || null;

  const payerNameSource = callbackRegistered
    ? PayerNameSource.CALLBACK_REGISTERED_NAME
    : declaredName
      ? PayerNameSource.CHECKOUT_DECLARED_NAME
      : payment.order.shippingName
        ? PayerNameSource.SHIPPING_NAME
        : accountName
          ? PayerNameSource.ACCOUNT_NAME
          : PayerNameSource.UNKNOWN;

  const payerPhone =
    (typeof mpesaMeta.callbackPhoneNumber === "string" ? mpesaMeta.callbackPhoneNumber : null) ||
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
} satisfies Prisma.ReceiptSelect;

const toResponse = (receipt: Prisma.ReceiptGetPayload<{ select: typeof getReceiptProjection }>) => ({
  ...receipt,
  subtotal: Number(receipt.subtotal),
  tax: Number(receipt.tax),
  shippingFee: Number(receipt.shippingFee),
  total: Number(receipt.total),
});

const getPaymentForReceipt = (client: PrismaClient | Prisma.TransactionClient, paymentId: string) =>
  client.payment.findUnique({
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

export const ensureReceiptForSuccessfulPayment = async (paymentId: string) => {
  const payment = (await getPaymentForReceipt(prisma, paymentId)) as ReceiptContext | null;

  if (!payment) {
    throw new AppError("Payment not found", 404);
  }

  if (payment.status !== PaymentStatus.SUCCESS) {
    return null;
  }

  if (payment.receipt) {
    return toResponse(payment.receipt as Prisma.ReceiptGetPayload<{ select: typeof getReceiptProjection }>);
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

  const created = await prisma.$transaction(async (tx) => {
    const current = (await getPaymentForReceipt(tx, paymentId)) as ReceiptContext | null;
    if (!current) {
      throw new AppError("Payment not found", 404);
    }

    if (current.receipt) {
      return current.receipt as Prisma.ReceiptGetPayload<{ select: typeof getReceiptProjection }>;
    }

    if (current.status !== PaymentStatus.SUCCESS) {
      throw new AppError("Cannot issue receipt before successful payment", 400);
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
            itemsSnapshot: itemsSnapshot as Prisma.InputJsonValue,
            meta: {
              generatedAt: new Date().toISOString(),
              paymentProvider: current.provider,
              paymentTransactionRef: current.transactionRef,
            } as Prisma.InputJsonValue,
          },
          select: {
            id: true,
          },
        });

        return tx.receipt.findUniqueOrThrow({
          where: { id: receipt.id },
          select: getReceiptProjection,
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          continue;
        }

        throw error;
      }
    }

    throw new AppError("Unable to generate unique receipt number", 500);
  });

  return toResponse(created);
};

export const getReceiptByIdForUser = async (receiptId: string, userId: string) => {
  const receipt = await prisma.receipt.findFirst({
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
    throw new AppError("Receipt not found", 404);
  }

  return {
    ...receipt,
    subtotal: Number(receipt.subtotal),
    tax: Number(receipt.tax),
    shippingFee: Number(receipt.shippingFee),
    total: Number(receipt.total),
  };
};

export const getReceiptByOrderForUser = async (orderId: string, userId: string) => {
  const receipt = await prisma.receipt.findFirst({
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
    throw new AppError("Receipt not found", 404);
  }

  return {
    ...receipt,
    subtotal: Number(receipt.subtotal),
    tax: Number(receipt.tax),
    shippingFee: Number(receipt.shippingFee),
    total: Number(receipt.total),
  };
};
