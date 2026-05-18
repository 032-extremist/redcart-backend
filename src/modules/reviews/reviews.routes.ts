import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth";
import { requireCsrf } from "../../middleware/csrf";
import { validate } from "../../middleware/validate";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/appError";

const router = Router();

const createReviewSchema = z.object({
  body: z.object({
    productId: z.string().min(1),
    rating: z.number().int().min(1).max(5),
    comment: z.string().min(2).max(500),
  }),
  query: z.object({}),
  params: z.object({}),
});

const productReviewsSchema = z.object({
  body: z.object({}),
  query: z.object({}),
  params: z.object({ productId: z.string().min(1) }),
});

router.get("/product/:productId", validate(productReviewsSchema), async (req, res, next) => {
  try {
    const reviews = await prisma.review.findMany({
      where: { productId: req.params.productId },
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(reviews);
  } catch (error) {
    next(error);
  }
});

router.post("/", authenticate, requireCsrf, validate(createReviewSchema), async (req, res, next) => {
  try {
    const { productId, rating, comment } = req.body;

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new AppError("Product not found", 404);
    }

    const review = await prisma.review.upsert({
      where: {
        userId_productId: {
          userId: req.auth!.userId,
          productId,
        },
      },
      create: {
        userId: req.auth!.userId,
        productId,
        rating,
        comment,
      },
      update: {
        rating,
        comment,
      },
    });

    const aggregate = await prisma.review.aggregate({
      where: { productId },
      _avg: { rating: true },
      _count: { _all: true },
    });

    await prisma.product.update({
      where: { id: productId },
      data: {
        rating: aggregate._avg.rating ?? 0,
        reviewCount: aggregate._count._all,
      },
    });

    res.status(201).json(review);
  } catch (error) {
    next(error);
  }
});

export default router;
