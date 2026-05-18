import { Router } from "express";
import { z } from "zod";
import { optionalAuthenticate } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { prisma } from "../../lib/prisma";

const router = Router();

const chatSchema = z.object({
  body: z.object({
    message: z.string().min(1),
  }),
  query: z.object({}),
  params: z.object({}),
});

const sessionContext = new Map<string, string[]>();

router.post("/chat", optionalAuthenticate, validate(chatSchema), async (req, res, next) => {
  try {
    const userId = req.auth?.userId;
    const message = req.body.message.trim();
    const normalized = message.toLowerCase();

    const contextId = userId ?? "guest";
    const context = sessionContext.get(contextId) ?? [];
    context.push(message);
    sessionContext.set(contextId, context.slice(-8));

    if (normalized.includes("order") && (normalized.includes("status") || normalized.includes("track"))) {
      if (!userId) {
        return res.json({
          reply: "Login is required for order status checks. I can still help with products, stock, and pricing.",
          suggestions: [],
        });
      }

      const recentOrder = await prisma.order.findFirst({
        where: { userId },
        include: { payment: true },
        orderBy: { createdAt: "desc" },
      });

      if (!recentOrder) {
        return res.json({
          reply: "You do not have any orders yet. Add items to cart and complete checkout to start tracking.",
          suggestions: [],
        });
      }

      return res.json({
        reply: `Your latest order ${recentOrder.id} is currently ${recentOrder.status}. Payment status: ${
          recentOrder.payment?.status ?? "N/A"
        }.`,
        suggestions: [],
      });
    }

    const keyword = normalized
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token: string) => token.length > 2)
      .slice(0, 4);

    const products = await prisma.product.findMany({
      where: keyword.length
        ? {
            OR: keyword.flatMap((token: string) => [
              { name: { contains: token, mode: "insensitive" } },
              { description: { contains: token, mode: "insensitive" } },
              { category: { name: { contains: token, mode: "insensitive" } } },
              { subcategory: { name: { contains: token, mode: "insensitive" } } },
            ]),
          }
        : { isFeatured: true },
      include: {
        category: { select: { name: true } },
        subcategory: { select: { name: true } },
      },
      orderBy: [{ rating: "desc" }, { reviewCount: "desc" }],
      take: 4,
    });

    if (products.length === 0) {
      return res.json({
        reply: "I could not find a direct match. Try product name, category, or use the shop filters.",
        suggestions: [],
      });
    }

    const recommendationText = products
      .map((p) => `${p.name} (${p.category.name}${p.subcategory ? ` / ${p.subcategory.name}` : ""}) - $${Number(p.price)}`)
      .join("; ");

    res.json({
      reply: `Based on your request, I recommend: ${recommendationText}`,
      suggestions: products.map((product) => ({
        id: product.id,
        name: product.name,
        slug: product.slug,
        price: Number(product.price),
        imageUrl: product.imageUrl,
      })),
      contextWindow: context,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
