import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth";
import { requireCsrf } from "../../middleware/csrf";
import { validate } from "../../middleware/validate";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/appError";

const router = Router();

const addItemSchema = z.object({
  body: z.object({
    productId: z.string().min(1),
    quantity: z.number().int().min(1).max(50).default(1),
  }),
  query: z.object({}),
  params: z.object({}),
});

const updateItemSchema = z.object({
  body: z.object({
    quantity: z.number().int().min(1).max(50),
  }),
  query: z.object({}),
  params: z.object({ itemId: z.string().min(1) }),
});

const deleteItemSchema = z.object({
  body: z.object({}),
  query: z.object({}),
  params: z.object({ itemId: z.string().min(1) }),
});

router.use(authenticate);

const getCartResponse = async (userId: string) => {
  const cart = await prisma.cart.findUnique({
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
    const created = await prisma.cart.create({
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
    const cart = await getCartResponse(req.auth!.userId);
    res.json(cart);
  } catch (error) {
    next(error);
  }
});

router.post("/items", requireCsrf, validate(addItemSchema), async (req, res, next) => {
  try {
    const { productId, quantity } = req.body;
    const userId = req.auth!.userId;

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new AppError("Product not found", 404);
    }

    if (product.stock < quantity) {
      throw new AppError("Insufficient stock", 400);
    }

    const cart = await prisma.cart.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });

    const existingItem = await prisma.cartItem.findUnique({
      where: {
        cartId_productId: {
          cartId: cart.id,
          productId,
        },
      },
    });

    const nextQuantity = existingItem ? existingItem.quantity + quantity : quantity;
    if (nextQuantity > product.stock) {
      throw new AppError("Requested quantity exceeds stock", 400);
    }

    await prisma.cartItem.upsert({
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
  } catch (error) {
    next(error);
  }
});

router.patch("/items/:itemId", requireCsrf, validate(updateItemSchema), async (req, res, next) => {
  try {
    const { itemId } = req.params;
    const { quantity } = req.body;

    const item = await prisma.cartItem.findFirst({
      where: {
        id: itemId,
        cart: {
          userId: req.auth!.userId,
        },
      },
      include: {
        product: true,
      },
    });

    if (!item) {
      throw new AppError("Cart item not found", 404);
    }

    if (quantity > item.product.stock) {
      throw new AppError("Requested quantity exceeds stock", 400);
    }

    await prisma.cartItem.update({
      where: { id: itemId },
      data: { quantity },
    });

    const response = await getCartResponse(req.auth!.userId);
    res.json(response);
  } catch (error) {
    next(error);
  }
});

router.delete("/items/:itemId", requireCsrf, validate(deleteItemSchema), async (req, res, next) => {
  try {
    const { itemId } = req.params;
    const item = await prisma.cartItem.findFirst({
      where: {
        id: itemId,
        cart: {
          userId: req.auth!.userId,
        },
      },
    });

    if (!item) {
      throw new AppError("Cart item not found", 404);
    }

    await prisma.cartItem.delete({ where: { id: itemId } });

    const response = await getCartResponse(req.auth!.userId);
    res.json(response);
  } catch (error) {
    next(error);
  }
});

export default router;
