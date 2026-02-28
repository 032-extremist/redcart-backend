import { Product } from "@prisma/client";

export const productToResponse = (product: Product & { category?: { name: string; slug: string }; subcategory?: { name: string; slug: string } | null }) => ({
  ...product,
  price: Number(product.price),
  category: product.category,
  subcategory: product.subcategory,
});

export const orderAmountToNumber = <T extends { total: unknown }>(order: T) => ({
  ...order,
  total: Number(order.total as number),
});
