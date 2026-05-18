import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const categoryMap: Record<string, string[]> = {
  Electronics: ["Phones", "Laptops", "Televisions", "Accessories"],
  Clothing: ["Men", "Women", "Kids"],
  Utensils: ["Kitchenware", "Cookware", "Cutlery"],
  Furniture: ["Living Room", "Bedroom", "Office"],
};

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");

async function upsertCategories() {
  const subcategoryIds: Record<string, number> = {};

  for (const [categoryName, subcategories] of Object.entries(categoryMap)) {
    const category = await prisma.category.upsert({
      where: { slug: slugify(categoryName) },
      create: {
        name: categoryName,
        slug: slugify(categoryName),
      },
      update: {},
    });

    for (const subcategoryName of subcategories) {
      const subcategory = await prisma.subcategory.upsert({
        where: { slug: slugify(`${categoryName}-${subcategoryName}`) },
        create: {
          name: subcategoryName,
          slug: slugify(`${categoryName}-${subcategoryName}`),
          categoryId: category.id,
        },
        update: {},
      });

      subcategoryIds[`${categoryName}:${subcategoryName}`] = subcategory.id;
    }
  }

  return subcategoryIds;
}

async function seedProducts(subcategoryIds: Record<string, number>) {
  const categories = await prisma.category.findMany();
  const catId = Object.fromEntries(categories.map((c) => [c.name, c.id]));

  const products = [
    {
      name: "Budget USB-C Cable",
      description: "Durable 1m USB-C charging and data cable.",
      price: 1,
      stock: 120,
      category: "Electronics",
      subcategory: "Accessories",
      imageUrl: "https://images.unsplash.com/photo-1587033411391-5d9e51cce126",
      isFeatured: false,
    },
    {
      name: "Mini Pocket Notebook",
      description: "Compact everyday note pad for quick lists and ideas.",
      price: 2,
      stock: 140,
      category: "Utensils",
      subcategory: "Kitchenware",
      imageUrl: "https://images.unsplash.com/photo-1531346878377-a5be20888e57",
      isFeatured: false,
    },
    {
      name: "Starter Cutlery Spoon Set",
      description: "Affordable stainless steel spoon starter set.",
      price: 3,
      stock: 95,
      category: "Utensils",
      subcategory: "Cutlery",
      imageUrl: "https://images.unsplash.com/photo-1590794056226-79ef3a8147e1",
      isFeatured: false,
    },
    {
      name: "Classic Cotton Handkerchief",
      description: "Soft reusable cotton handkerchief for daily use.",
      price: 4,
      stock: 160,
      category: "Clothing",
      subcategory: "Men",
      imageUrl: "https://images.unsplash.com/photo-1620799140408-edc6dcb6d633",
      isFeatured: false,
    },
    {
      name: "Single Ceramic Mug",
      description: "Simple ceramic mug for tea, coffee, and hot drinks.",
      price: 5,
      stock: 110,
      category: "Utensils",
      subcategory: "Kitchenware",
      imageUrl: "https://images.unsplash.com/photo-1514228742587-6b1558fcf93a",
      isFeatured: false,
    },
    {
      name: "RedCart X1 Smartphone",
      description: "5G smartphone with AI camera and all-day battery life.",
      price: 499,
      stock: 42,
      category: "Electronics",
      subcategory: "Phones",
      imageUrl: "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9",
      isFeatured: true,
    },
    {
      name: "ApexBook Pro 14",
      description: "Lightweight enterprise laptop for developers and creators.",
      price: 1199,
      stock: 28,
      category: "Electronics",
      subcategory: "Laptops",
      imageUrl: "https://images.unsplash.com/photo-1496181133206-80ce9b88a853",
      isFeatured: true,
    },
    {
      name: "UltraView 55 Smart TV",
      description: "4K UHD smart television with HDR and streaming apps.",
      price: 699,
      stock: 15,
      category: "Electronics",
      subcategory: "Televisions",
      imageUrl: "https://images.unsplash.com/photo-1593784991095-a205069470b6",
      isFeatured: false,
    },
    {
      name: "Executive Oxford Shirt",
      description: "Wrinkle-resistant premium cotton shirt for men.",
      price: 59,
      stock: 90,
      category: "Clothing",
      subcategory: "Men",
      imageUrl: "https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf",
      isFeatured: true,
    },
    {
      name: "Aura Dress",
      description: "Elegant red evening dress with modern tailoring.",
      price: 89,
      stock: 56,
      category: "Clothing",
      subcategory: "Women",
      imageUrl: "https://images.unsplash.com/photo-1595777457583-95e059d581b8",
      isFeatured: false,
    },
    {
      name: "Kids Summer Set",
      description: "Comfortable 2-piece summer outfit for kids.",
      price: 35,
      stock: 70,
      category: "Clothing",
      subcategory: "Kids",
      imageUrl: "https://images.unsplash.com/photo-1519238263530-99bdd11df2ea",
      isFeatured: false,
    },
    {
      name: "ChefPro Knife Set",
      description: "8-piece stainless steel kitchen knife set.",
      price: 129,
      stock: 34,
      category: "Utensils",
      subcategory: "Cutlery",
      imageUrl: "https://images.unsplash.com/photo-1590794056226-79ef3a8147e1",
      isFeatured: true,
    },
    {
      name: "ThermoCook Pan",
      description: "Non-stick cookware pan with heat-resistant handle.",
      price: 49,
      stock: 61,
      category: "Utensils",
      subcategory: "Cookware",
      imageUrl: "https://images.unsplash.com/photo-1583778176476-4a8b02c51d2b",
      isFeatured: false,
    },
    {
      name: "Metro 3-Seater Sofa",
      description: "Modern living room sofa with high-density foam comfort.",
      price: 899,
      stock: 11,
      category: "Furniture",
      subcategory: "Living Room",
      imageUrl: "https://images.unsplash.com/photo-1555041469-a586c61ea9bc",
      isFeatured: true,
    },
    {
      name: "Ergo Office Desk",
      description: "Spacious office desk designed for productivity.",
      price: 399,
      stock: 23,
      category: "Furniture",
      subcategory: "Office",
      imageUrl: "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85",
      isFeatured: false,
    },
  ];

  for (const product of products) {
    await prisma.product.upsert({
      where: { slug: slugify(product.name) },
      create: {
        name: product.name,
        slug: slugify(product.name),
        description: product.description,
        price: product.price,
        stock: product.stock,
        categoryId: catId[product.category],
        subcategoryId: subcategoryIds[`${product.category}:${product.subcategory}`],
        imageUrl: product.imageUrl,
        isFeatured: product.isFeatured,
      },
      update: {},
    });
  }
}

async function seedUsers() {
  const adminPassword = await bcrypt.hash("Admin@123", 12);
  const customerPassword = await bcrypt.hash("Customer@123", 12);

  const admin = await prisma.user.upsert({
    where: { email: "admin@redcart.com" },
    create: {
      email: "admin@redcart.com",
      passwordHash: adminPassword,
      firstName: "System",
      lastName: "Admin",
      role: Role.ADMIN,
      phone: "+254700000000",
      cart: { create: {} },
    },
    update: {},
  });

  await prisma.user.upsert({
    where: { email: "customer@redcart.com" },
    create: {
      email: "customer@redcart.com",
      passwordHash: customerPassword,
      firstName: "Default",
      lastName: "Customer",
      role: Role.CUSTOMER,
      phone: "+254711111111",
      cart: { create: {} },
    },
    update: {},
  });

  return admin;
}

async function main() {
  await seedUsers();
  const subcategoryIds = await upsertCategories();
  await seedProducts(subcategoryIds);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log("Seed complete.");
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
