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

type ProductSeed = {
  name: string;
  description: string;
  price: number;
  stock: number;
  category: keyof typeof categoryMap;
  subcategory: string;
  imageUrl: string;
  isFeatured: boolean;
};

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

  const products: ProductSeed[] = [
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
    {
      name: "NovaMax 5G Smartphone",
      description: "Sleek dual-SIM phone with a bright OLED display, fast charging, and crisp night photography.",
      price: 349,
      stock: 64,
      category: "Electronics",
      subcategory: "Phones",
      imageUrl: "https://images.unsplash.com/photo-1598327105666-5b89351aff97",
      isFeatured: true,
    },
    {
      name: "PixelCore A7",
      description: "Affordable Android smartphone with smooth performance, long battery life, and expandable storage.",
      price: 229,
      stock: 88,
      category: "Electronics",
      subcategory: "Phones",
      imageUrl: "https://images.unsplash.com/photo-1565849904461-04a58ad377e0",
      isFeatured: false,
    },
    {
      name: "Titan Fold Mini",
      description: "Compact foldable phone with multitasking power and a pocket-friendly premium build.",
      price: 899,
      stock: 18,
      category: "Electronics",
      subcategory: "Phones",
      imageUrl: "https://images.unsplash.com/photo-1601784551446-20c9e07cdbdb",
      isFeatured: true,
    },
    {
      name: "RedCart Lite 4G",
      description: "Everyday smartphone for calls, browsing, social apps, and reliable mobile payments.",
      price: 149,
      stock: 120,
      category: "Electronics",
      subcategory: "Phones",
      imageUrl: "https://images.unsplash.com/photo-1512428559087-560fa5ceab42",
      isFeatured: false,
    },
    {
      name: "StudioBook Air 13",
      description: "Thin laptop with a sharp display, quiet keyboard, and battery life for work on the move.",
      price: 849,
      stock: 31,
      category: "Electronics",
      subcategory: "Laptops",
      imageUrl: "https://images.unsplash.com/photo-1517336714731-489689fd1ca8",
      isFeatured: true,
    },
    {
      name: "CreatorBook 16",
      description: "Large-screen laptop for design, editing, and multitasking with generous memory and storage.",
      price: 1399,
      stock: 19,
      category: "Electronics",
      subcategory: "Laptops",
      imageUrl: "https://images.unsplash.com/photo-1525547719571-a2d4ac8945e2",
      isFeatured: true,
    },
    {
      name: "Classmate Chromebook",
      description: "Lightweight study laptop with quick startup, cloud storage, and a spill-resistant keyboard.",
      price: 269,
      stock: 72,
      category: "Electronics",
      subcategory: "Laptops",
      imageUrl: "https://images.unsplash.com/photo-1484788984921-03950022c9ef",
      isFeatured: false,
    },
    {
      name: "ProDesk Workstation",
      description: "Reliable business laptop with strong security, many ports, and dependable daily performance.",
      price: 999,
      stock: 24,
      category: "Electronics",
      subcategory: "Laptops",
      imageUrl: "https://images.unsplash.com/photo-1498050108023-c5249f4df085",
      isFeatured: false,
    },
    {
      name: "CineView 65 QLED TV",
      description: "Large 4K smart TV with vivid color, slim bezels, and smooth streaming app support.",
      price: 1199,
      stock: 12,
      category: "Electronics",
      subcategory: "Televisions",
      imageUrl: "https://images.unsplash.com/photo-1601944179066-29786cb9d32a",
      isFeatured: true,
    },
    {
      name: "FamilyView 43 Smart TV",
      description: "Compact smart television with Full HD picture quality and easy app navigation.",
      price: 329,
      stock: 36,
      category: "Electronics",
      subcategory: "Televisions",
      imageUrl: "https://images.unsplash.com/photo-1461151304267-38535e780c79",
      isFeatured: false,
    },
    {
      name: "GameView 50 HDR TV",
      description: "Responsive 4K TV with HDR contrast and low-latency mode for console gaming.",
      price: 549,
      stock: 22,
      category: "Electronics",
      subcategory: "Televisions",
      imageUrl: "https://images.unsplash.com/photo-1593305841991-05c297ba4575",
      isFeatured: false,
    },
    {
      name: "UltraSlim 32 LED TV",
      description: "Budget-friendly LED TV for bedrooms, hostels, offices, and small living rooms.",
      price: 199,
      stock: 48,
      category: "Electronics",
      subcategory: "Televisions",
      imageUrl: "https://images.unsplash.com/photo-1593359677879-a4bb92f829d1",
      isFeatured: false,
    },
    {
      name: "Pulse Wireless Earbuds",
      description: "Compact earbuds with punchy sound, touch controls, and a pocket charging case.",
      price: 69,
      stock: 140,
      category: "Electronics",
      subcategory: "Accessories",
      imageUrl: "https://images.unsplash.com/photo-1606220588913-b3aacb4d2f46",
      isFeatured: true,
    },
    {
      name: "ChargeHub 20000 Power Bank",
      description: "High-capacity portable charger with dual USB output and fast phone top-ups.",
      price: 45,
      stock: 96,
      category: "Electronics",
      subcategory: "Accessories",
      imageUrl: "https://images.unsplash.com/photo-1609091839311-d5365f9ff1c5",
      isFeatured: false,
    },
    {
      name: "Orbit Bluetooth Speaker",
      description: "Portable speaker with deep bass, splash resistance, and all-day battery life.",
      price: 59,
      stock: 74,
      category: "Electronics",
      subcategory: "Accessories",
      imageUrl: "https://images.unsplash.com/photo-1608043152269-423dbba4e7e1",
      isFeatured: false,
    },
    {
      name: "FlexFit Smart Watch",
      description: "Fitness watch with heart-rate tracking, notifications, sleep insights, and water resistance.",
      price: 129,
      stock: 52,
      category: "Electronics",
      subcategory: "Accessories",
      imageUrl: "https://images.unsplash.com/photo-1579586337278-3befd40fd17a",
      isFeatured: true,
    },
    {
      name: "Linen Casual Shirt",
      description: "Breathable men's linen shirt with a relaxed fit for warm weekends and holidays.",
      price: 44,
      stock: 84,
      category: "Clothing",
      subcategory: "Men",
      imageUrl: "https://images.unsplash.com/photo-1596755094514-f87e34085b2c",
      isFeatured: false,
    },
    {
      name: "Urban Denim Jacket",
      description: "Classic denim jacket with durable stitching and easy layering for cool evenings.",
      price: 79,
      stock: 46,
      category: "Clothing",
      subcategory: "Men",
      imageUrl: "https://images.unsplash.com/photo-1548883354-7622d03aca27",
      isFeatured: true,
    },
    {
      name: "Athletic Jogger Pants",
      description: "Soft tapered joggers with stretch fabric, zip pockets, and a comfortable waistband.",
      price: 39,
      stock: 112,
      category: "Clothing",
      subcategory: "Men",
      imageUrl: "https://images.unsplash.com/photo-1506629905607-d405b7a30db9",
      isFeatured: false,
    },
    {
      name: "Formal Leather Belt",
      description: "Polished leather belt with a metal buckle for office wear and special occasions.",
      price: 29,
      stock: 130,
      category: "Clothing",
      subcategory: "Men",
      imageUrl: "https://images.unsplash.com/photo-1624222247344-550fb60583dc",
      isFeatured: false,
    },
    {
      name: "Satin Wrap Dress",
      description: "Elegant satin dress with a flattering waist tie and flowing evening silhouette.",
      price: 99,
      stock: 38,
      category: "Clothing",
      subcategory: "Women",
      imageUrl: "https://images.unsplash.com/photo-1566174053879-31528523f8ae",
      isFeatured: true,
    },
    {
      name: "Everyday Tote Bag",
      description: "Roomy tote bag with reinforced handles for work, errands, shopping, and travel.",
      price: 54,
      stock: 77,
      category: "Clothing",
      subcategory: "Women",
      imageUrl: "https://images.unsplash.com/photo-1542291026-7eec264c27ff",
      isFeatured: false,
    },
    {
      name: "Soft Knit Cardigan",
      description: "Cozy long-sleeve cardigan with a soft knit feel and easy layering fit.",
      price: 64,
      stock: 58,
      category: "Clothing",
      subcategory: "Women",
      imageUrl: "https://images.unsplash.com/photo-1434389677669-e08b4cac3105",
      isFeatured: false,
    },
    {
      name: "Classic White Sneakers",
      description: "Minimal white sneakers with cushioned soles for daily wear and casual outfits.",
      price: 74,
      stock: 91,
      category: "Clothing",
      subcategory: "Women",
      imageUrl: "https://images.unsplash.com/photo-1549298916-b41d501d3772",
      isFeatured: true,
    },
    {
      name: "Kids Rainbow Hoodie",
      description: "Warm children's hoodie with bright color blocking and a soft fleece interior.",
      price: 31,
      stock: 86,
      category: "Clothing",
      subcategory: "Kids",
      imageUrl: "https://images.unsplash.com/photo-1503944583220-79d8926ad5e2",
      isFeatured: false,
    },
    {
      name: "Junior Denim Overalls",
      description: "Durable denim overalls for active kids with adjustable straps and roomy pockets.",
      price: 42,
      stock: 63,
      category: "Clothing",
      subcategory: "Kids",
      imageUrl: "https://images.unsplash.com/photo-1522771930-78848d9293e8",
      isFeatured: true,
    },
    {
      name: "Playground Trainers",
      description: "Light kids' trainers with grippy soles and easy hook-and-loop straps.",
      price: 36,
      stock: 104,
      category: "Clothing",
      subcategory: "Kids",
      imageUrl: "https://images.unsplash.com/photo-1514989940723-e8e51635b782",
      isFeatured: false,
    },
    {
      name: "Cotton Pajama Set",
      description: "Soft cotton pajama set for children with breathable fabric and playful prints.",
      price: 28,
      stock: 97,
      category: "Clothing",
      subcategory: "Kids",
      imageUrl: "https://images.unsplash.com/photo-1519238263530-99bdd11df2ea",
      isFeatured: false,
    },
    {
      name: "Stoneware Dinner Set",
      description: "Elegant twelve-piece stoneware dinner set for everyday meals and weekend hosting.",
      price: 89,
      stock: 44,
      category: "Utensils",
      subcategory: "Kitchenware",
      imageUrl: "https://images.unsplash.com/photo-1516594798947-e65505dbb29d",
      isFeatured: true,
    },
    {
      name: "Glass Storage Jar Trio",
      description: "Airtight glass jars for storing grains, snacks, coffee, sugar, and pantry staples.",
      price: 24,
      stock: 118,
      category: "Utensils",
      subcategory: "Kitchenware",
      imageUrl: "https://images.unsplash.com/photo-1584306670957-acf935f5033c",
      isFeatured: false,
    },
    {
      name: "Bamboo Chopping Board",
      description: "Durable bamboo board with a smooth cutting surface and easy-clean finish.",
      price: 18,
      stock: 150,
      category: "Utensils",
      subcategory: "Kitchenware",
      imageUrl: "https://images.unsplash.com/photo-1593618998160-e34014e67546",
      isFeatured: false,
    },
    {
      name: "Ceramic Mixing Bowl Set",
      description: "Nested ceramic bowls for baking, serving salads, mixing batter, and meal prep.",
      price: 39,
      stock: 66,
      category: "Utensils",
      subcategory: "Kitchenware",
      imageUrl: "https://images.unsplash.com/photo-1583947581924-a31cf1ff2f3f",
      isFeatured: false,
    },
    {
      name: "Cast Iron Skillet",
      description: "Heavy-duty skillet that holds heat beautifully for searing, frying, and baking.",
      price: 55,
      stock: 53,
      category: "Utensils",
      subcategory: "Cookware",
      imageUrl: "https://images.unsplash.com/photo-1556911220-bff31c812dba",
      isFeatured: true,
    },
    {
      name: "Granite Saucepan Set",
      description: "Three-piece non-stick saucepan set with heat-resistant handles and matching lids.",
      price: 84,
      stock: 41,
      category: "Utensils",
      subcategory: "Cookware",
      imageUrl: "https://images.unsplash.com/photo-1584990347449-a98b2b3f6f42",
      isFeatured: false,
    },
    {
      name: "Stainless Stock Pot",
      description: "Large stainless steel pot for soups, stews, pasta, and family-size meals.",
      price: 62,
      stock: 37,
      category: "Utensils",
      subcategory: "Cookware",
      imageUrl: "https://images.unsplash.com/photo-1586201375761-83865001e31c",
      isFeatured: false,
    },
    {
      name: "Nonstick Wok Pan",
      description: "Deep wok pan for stir-fries, noodles, vegetables, and fast weeknight cooking.",
      price: 47,
      stock: 58,
      category: "Utensils",
      subcategory: "Cookware",
      imageUrl: "https://images.unsplash.com/photo-1556910103-1c02745aae4d",
      isFeatured: false,
    },
    {
      name: "Premium Steak Knife Set",
      description: "Six sharp steak knives with balanced handles for smooth table service.",
      price: 49,
      stock: 72,
      category: "Utensils",
      subcategory: "Cutlery",
      imageUrl: "https://images.unsplash.com/photo-1593618998160-e34014e67546",
      isFeatured: false,
    },
    {
      name: "Gold Finish Cutlery Set",
      description: "Twenty-four-piece cutlery set with a warm gold finish for special dinners.",
      price: 79,
      stock: 35,
      category: "Utensils",
      subcategory: "Cutlery",
      imageUrl: "https://images.unsplash.com/photo-1610701596007-11502861dcfa",
      isFeatured: true,
    },
    {
      name: "Everyday Fork Pack",
      description: "Simple stainless steel fork pack for daily meals, office kitchens, and cafes.",
      price: 16,
      stock: 160,
      category: "Utensils",
      subcategory: "Cutlery",
      imageUrl: "https://images.unsplash.com/photo-1590794056226-79ef3a8147e1",
      isFeatured: false,
    },
    {
      name: "Chef Utility Knife",
      description: "Sharp utility knife for slicing fruit, trimming vegetables, and quick prep work.",
      price: 22,
      stock: 94,
      category: "Utensils",
      subcategory: "Cutlery",
      imageUrl: "https://images.unsplash.com/photo-1566454825481-9c23bb63b7c9",
      isFeatured: false,
    },
    {
      name: "CloudRest Recliner Chair",
      description: "Plush recliner with padded arms, smooth reclining action, and lounge-ready comfort.",
      price: 499,
      stock: 14,
      category: "Furniture",
      subcategory: "Living Room",
      imageUrl: "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85",
      isFeatured: true,
    },
    {
      name: "Nordic Coffee Table",
      description: "Minimal wooden coffee table with clean lines and a practical lower shelf.",
      price: 189,
      stock: 29,
      category: "Furniture",
      subcategory: "Living Room",
      imageUrl: "https://images.unsplash.com/photo-1493663284031-b7e3aaa4cab7",
      isFeatured: false,
    },
    {
      name: "Velvet Accent Chair",
      description: "Soft velvet accent chair that adds color, texture, and comfort to any corner.",
      price: 249,
      stock: 26,
      category: "Furniture",
      subcategory: "Living Room",
      imageUrl: "https://images.unsplash.com/photo-1567016432779-094069958ea5",
      isFeatured: false,
    },
    {
      name: "Media Console Cabinet",
      description: "Low media cabinet with cable cutouts, sliding storage, and a modern wood finish.",
      price: 329,
      stock: 21,
      category: "Furniture",
      subcategory: "Living Room",
      imageUrl: "https://images.unsplash.com/photo-1616486338812-3dadae4b4ace",
      isFeatured: false,
    },
    {
      name: "Serenity Queen Bed Frame",
      description: "Sturdy queen bed frame with a padded headboard and strong wooden support slats.",
      price: 649,
      stock: 13,
      category: "Furniture",
      subcategory: "Bedroom",
      imageUrl: "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85",
      isFeatured: true,
    },
    {
      name: "Two-Drawer Nightstand",
      description: "Compact bedside table with two drawers for books, chargers, glasses, and essentials.",
      price: 149,
      stock: 42,
      category: "Furniture",
      subcategory: "Bedroom",
      imageUrl: "https://images.unsplash.com/photo-1616594039964-ae9021a400a0",
      isFeatured: false,
    },
    {
      name: "Six-Drawer Dresser",
      description: "Spacious dresser with smooth drawers and a clean design for organized bedrooms.",
      price: 389,
      stock: 17,
      category: "Furniture",
      subcategory: "Bedroom",
      imageUrl: "https://images.unsplash.com/photo-1618220179428-22790b461013",
      isFeatured: false,
    },
    {
      name: "Memory Foam Mattress",
      description: "Supportive mattress with pressure-relief foam and a breathable sleep surface.",
      price: 529,
      stock: 24,
      category: "Furniture",
      subcategory: "Bedroom",
      imageUrl: "https://images.unsplash.com/photo-1631049307264-da0ec9d70304",
      isFeatured: true,
    },
    {
      name: "AeroMesh Office Chair",
      description: "Breathable ergonomic chair with lumbar support, adjustable height, and rolling base.",
      price: 219,
      stock: 38,
      category: "Furniture",
      subcategory: "Office",
      imageUrl: "https://images.unsplash.com/photo-1580480055273-228ff5388ef8",
      isFeatured: true,
    },
    {
      name: "Compact Writing Desk",
      description: "Small-space desk with a smooth worktop for laptops, study, and paperwork.",
      price: 179,
      stock: 33,
      category: "Furniture",
      subcategory: "Office",
      imageUrl: "https://images.unsplash.com/photo-1518455027359-f3f8164ba6bd",
      isFeatured: false,
    },
    {
      name: "Adjustable Standing Desk",
      description: "Height-adjustable workstation for switching between sitting and standing throughout the day.",
      price: 499,
      stock: 16,
      category: "Furniture",
      subcategory: "Office",
      imageUrl: "https://images.unsplash.com/photo-1497366811353-6870744d04b2",
      isFeatured: true,
    },
    {
      name: "Five-Shelf Bookcase",
      description: "Tall bookcase for books, files, decor, and tidy home office storage.",
      price: 159,
      stock: 47,
      category: "Furniture",
      subcategory: "Office",
      imageUrl: "https://images.unsplash.com/photo-1524758631624-e2822e304c36",
      isFeatured: false,
    },
  ];

  for (const product of products) {
    const categoryId = catId[product.category];
    const subcategoryId = subcategoryIds[`${product.category}:${product.subcategory}`];
    const data = {
      name: product.name,
      description: product.description,
      price: product.price,
      stock: product.stock,
      categoryId,
      subcategoryId,
      imageUrl: product.imageUrl,
      isFeatured: product.isFeatured,
    };

    if (!categoryId || !subcategoryId) {
      throw new Error(`Invalid seed category path: ${product.category}:${product.subcategory}`);
    }

    await prisma.product.upsert({
      where: { slug: slugify(product.name) },
      create: {
        ...data,
        slug: slugify(product.name),
      },
      update: data,
    });
  }

  console.log(`Seeded ${products.length} products.`);
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
