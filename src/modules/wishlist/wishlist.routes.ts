import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth";
import { requireCsrf } from "../../middleware/csrf";
import { validate } from "../../middleware/validate";
import { prisma } from "../../lib/prisma";

const router = Router();

const addWishlistSchema = z.object({
  body: z.object({ productId: z.string().min(1) }),
  query: z.object({}),
  params: z.object({}),
});

const deleteWishlistSchema = z.object({
  body: z.object({}),
  query: z.object({}),
  params: z.object({ productId: z.string().min(1) }),
});

router.use(authenticate);

router.get("/", async (req, res, next) => {
  try {
    const data = await prisma.wishlistItem.findMany({
      where: { userId: req.auth!.userId },
      include: {
        product: {
          include: {
            category: { select: { name: true, slug: true } },
            subcategory: { select: { name: true, slug: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(
      data.map((item) => ({
        ...item,
        product: {
          ...item.product,
          price: Number(item.product.price),
        },
      })),
    );
  } catch (error) {
    next(error);
  }
});

router.post("/", requireCsrf, validate(addWishlistSchema), async (req, res, next) => {
  try {
    const created = await prisma.wishlistItem.upsert({
      where: {
        userId_productId: {
          userId: req.auth!.userId,
          productId: req.body.productId,
        },
      },
      create: {
        userId: req.auth!.userId,
        productId: req.body.productId,
      },
      update: {},
      include: {
        product: true,
      },
    });

    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
});

router.delete("/:productId", requireCsrf, validate(deleteWishlistSchema), async (req, res, next) => {
  try {
    await prisma.wishlistItem.deleteMany({
      where: {
        userId: req.auth!.userId,
        productId: req.params.productId,
      },
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
