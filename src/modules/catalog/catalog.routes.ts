import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { validate } from "../../middleware/validate";
import { prisma } from "../../lib/prisma";
import { productToResponse } from "../../utils/serializers";
import { AppError } from "../../utils/appError";

const router = Router();

const listProductsSchema = z.object({
  body: z.object({}),
  params: z.object({}),
  query: z.object({
    page: z.coerce.number().min(1).default(1),
    limit: z.coerce.number().min(1).max(48).default(12),
    category: z.string().optional(),
    subcategory: z.string().optional(),
    search: z.string().optional(),
    sort: z
      .enum(["newest", "price_low_high", "price_high_low", "rating"])
      .default("newest"),
    featured: z.coerce.boolean().optional(),
  }),
});

const singleProductSchema = z.object({
  body: z.object({}),
  query: z.object({}),
  params: z.object({ productIdOrSlug: z.string().min(1) }),
});

const sortToOrderBy: Record<string, Prisma.ProductOrderByWithRelationInput> = {
  newest: { createdAt: "desc" },
  price_low_high: { price: "asc" },
  price_high_low: { price: "desc" },
  rating: { rating: "desc" },
};

router.get("/categories", async (_req, res, next) => {
  try {
    const categories = await prisma.category.findMany({
      include: {
        subcategories: {
          orderBy: { name: "asc" },
        },
      },
      orderBy: { name: "asc" },
    });

    res.json(categories);
  } catch (error) {
    next(error);
  }
});

router.get("/products", validate(listProductsSchema), async (req, res, next) => {
  try {
    const { page, limit, category, subcategory, search, sort, featured } = req.query as unknown as z.infer<
      typeof listProductsSchema
    >["query"];

    const where: Prisma.ProductWhereInput = {
      ...(typeof featured === "boolean" ? { isFeatured: featured } : {}),
    };

    if (category) {
      where.category = {
        slug: category,
      };
    }

    if (subcategory) {
      where.subcategory = {
        slug: subcategory,
      };
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
        { category: { name: { contains: search, mode: "insensitive" } } },
        { subcategory: { name: { contains: search, mode: "insensitive" } } },
      ];
    }

    const skip = (page - 1) * limit;

    const [total, products] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        skip,
        take: limit,
        orderBy: sortToOrderBy[sort],
        include: {
          category: { select: { name: true, slug: true } },
          subcategory: { select: { name: true, slug: true } },
        },
      }),
    ]);

    res.json({
      data: products.map(productToResponse),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      message: total === 0 && search ? `No match found for '${search}'` : undefined,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/products/:productIdOrSlug", validate(singleProductSchema), async (req, res, next) => {
  try {
    const { productIdOrSlug } = req.params;

    const product = await prisma.product.findFirst({
      where: {
        OR: [{ id: productIdOrSlug }, { slug: productIdOrSlug }],
      },
      include: {
        category: { select: { name: true, slug: true } },
        subcategory: { select: { name: true, slug: true } },
        reviews: {
          include: {
            user: { select: { firstName: true, lastName: true } },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!product) {
      throw new AppError("Product not found", 404);
    }

    res.json({
      ...productToResponse(product),
      reviews: product.reviews,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
