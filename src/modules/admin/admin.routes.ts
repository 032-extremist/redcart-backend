import { Role } from "@prisma/client";
import { Router } from "express";
import fs from "fs";
import multer from "multer";
import path from "path";
import { z } from "zod";
import { authenticate, requireRole } from "../../middleware/auth";
import { requireCsrf } from "../../middleware/csrf";
import { validate } from "../../middleware/validate";
import { prisma } from "../../lib/prisma";
import { slugify } from "../../utils/slugify";
import { AppError } from "../../utils/appError";

const router = Router();
const uploadsDir = path.resolve(process.cwd(), "uploads", "products");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
    const base = slugify(path.basename(file.originalname, ext)) || "product-image";
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    cb(null, `${base}-${unique}${ext}`);
  },
});

const uploadImage = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      cb(new AppError("Only JPG, PNG, WEBP, and GIF images are allowed", 400));
      return;
    }
    cb(null, true);
  },
});

const createProductSchema = z.object({
  body: z.object({
    name: z.string().min(2),
    description: z.string().min(10),
    price: z.number().positive(),
    stock: z.number().int().min(0),
    imageUrl: z.string().url(),
    categoryId: z.number().int().positive(),
    subcategoryId: z.number().int().positive().optional(),
    isFeatured: z.boolean().default(false),
  }),
  query: z.object({}),
  params: z.object({}),
});

const updateProductSchema = z.object({
  body: z.object({
    name: z.string().min(2).optional(),
    description: z.string().min(10).optional(),
    price: z.number().positive().optional(),
    stock: z.number().int().min(0).optional(),
    imageUrl: z.string().url().optional(),
    categoryId: z.number().int().positive().optional(),
    subcategoryId: z.number().int().positive().nullable().optional(),
    isFeatured: z.boolean().optional(),
  }),
  query: z.object({}),
  params: z.object({ productId: z.string().min(1) }),
});

const productIdSchema = z.object({
  body: z.object({}),
  query: z.object({}),
  params: z.object({ productId: z.string().min(1) }),
});

const stockUpdateSchema = z.object({
  body: z.object({
    delta: z.number().int().refine((v) => v !== 0, "Delta cannot be zero"),
    reason: z.string().min(2),
  }),
  query: z.object({}),
  params: z.object({ productId: z.string().min(1) }),
});

router.use(authenticate, requireRole(Role.ADMIN));

router.post("/products/image", requireCsrf, uploadImage.single("image"), async (req, res, next) => {
  try {
    if (!req.file) {
      throw new AppError("Image file is required", 400);
    }

    const host = req.get("host");
    if (!host) {
      throw new AppError("Unable to resolve upload host", 500);
    }

    const imageUrl = `${req.protocol}://${host}/uploads/products/${req.file.filename}`;

    res.status(201).json({
      imageUrl,
      fileName: req.file.filename,
      size: req.file.size,
      mimeType: req.file.mimetype,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/analytics/sales", async (_req, res, next) => {
  try {
    const [ordersCount, revenueAgg, pendingPayments, topProducts] = await Promise.all([
      prisma.order.count(),
      prisma.order.aggregate({
        _sum: { total: true },
      }),
      prisma.payment.count({ where: { status: "PENDING" } }),
      prisma.orderItem.groupBy({
        by: ["productId"],
        _sum: { quantity: true, subtotal: true },
        orderBy: {
          _sum: {
            subtotal: "desc",
          },
        },
        take: 5,
      }),
    ]);

    const products = await prisma.product.findMany({
      where: { id: { in: topProducts.map((item) => item.productId) } },
      select: { id: true, name: true },
    });

    const productName = new Map(products.map((product) => [product.id, product.name]));

    res.json({
      ordersCount,
      totalRevenue: Number(revenueAgg._sum.total ?? 0),
      pendingPayments,
      topProducts: topProducts.map((item) => ({
        productId: item.productId,
        productName: productName.get(item.productId) ?? "Unknown",
        quantitySold: item._sum.quantity ?? 0,
        revenue: Number(item._sum.subtotal ?? 0),
      })),
    });
  } catch (error) {
    next(error);
  }
});

router.post("/products", requireCsrf, validate(createProductSchema), async (req, res, next) => {
  try {
    const { name, ...rest } = req.body;

    const product = await prisma.product.create({
      data: {
        ...rest,
        name,
        slug: slugify(name),
      },
    });

    res.status(201).json({ ...product, price: Number(product.price) });
  } catch (error) {
    next(error);
  }
});

router.patch("/products/:productId", requireCsrf, validate(updateProductSchema), async (req, res, next) => {
  try {
    const { productId } = req.params;
    const current = await prisma.product.findUnique({ where: { id: productId } });

    if (!current) {
      throw new AppError("Product not found", 404);
    }

    const nextSlug = req.body.name ? slugify(req.body.name) : current.slug;

    const product = await prisma.product.update({
      where: { id: productId },
      data: {
        ...req.body,
        slug: nextSlug,
      },
    });

    res.json({ ...product, price: Number(product.price) });
  } catch (error) {
    next(error);
  }
});

router.delete("/products/:productId", requireCsrf, validate(productIdSchema), async (req, res, next) => {
  try {
    await prisma.product.delete({ where: { id: req.params.productId } });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.post(
  "/products/:productId/stock",
  requireCsrf,
  validate(stockUpdateSchema),
  async (req, res, next) => {
    try {
      const { productId } = req.params;
      const { delta, reason } = req.body;

      const product = await prisma.product.findUnique({ where: { id: productId } });
      if (!product) {
        throw new AppError("Product not found", 404);
      }

      const nextStock = product.stock + delta;
      if (nextStock < 0) {
        throw new AppError("Stock cannot be negative", 400);
      }

      const updated = await prisma.$transaction(async (tx) => {
        const nextProduct = await tx.product.update({
          where: { id: productId },
          data: { stock: nextStock },
        });

        await tx.productStockLog.create({
          data: {
            productId,
            delta,
            reason,
          },
        });

        return nextProduct;
      });

      res.json({ ...updated, price: Number(updated.price) });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
