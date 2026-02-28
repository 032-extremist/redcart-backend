"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureLowPriceProducts = void 0;
const prisma_1 = require("../lib/prisma");
const logger_1 = require("../config/logger");
const slugify_1 = require("../utils/slugify");
const lowPriceProducts = [
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
];
const lowPriceCategoryMap = {
    Electronics: ["Accessories"],
    Clothing: ["Men"],
    Utensils: ["Kitchenware", "Cutlery"],
};
const ensureCategoryAndSubcategoryIds = async () => {
    const subcategoryIdByPath = new Map();
    const categoryIdByName = new Map();
    for (const [categoryName, subcategories] of Object.entries(lowPriceCategoryMap)) {
        const category = await prisma_1.prisma.category.upsert({
            where: { slug: (0, slugify_1.slugify)(categoryName) },
            create: { name: categoryName, slug: (0, slugify_1.slugify)(categoryName) },
            update: {},
        });
        categoryIdByName.set(categoryName, category.id);
        for (const subcategoryName of subcategories) {
            const slug = (0, slugify_1.slugify)(`${categoryName}-${subcategoryName}`);
            const subcategory = await prisma_1.prisma.subcategory.upsert({
                where: { slug },
                create: {
                    name: subcategoryName,
                    slug,
                    categoryId: category.id,
                },
                update: {},
            });
            subcategoryIdByPath.set(`${categoryName}:${subcategoryName}`, subcategory.id);
        }
    }
    return { categoryIdByName, subcategoryIdByPath };
};
const ensureLowPriceProducts = async () => {
    const { categoryIdByName, subcategoryIdByPath } = await ensureCategoryAndSubcategoryIds();
    let created = 0;
    for (const product of lowPriceProducts) {
        const slug = (0, slugify_1.slugify)(product.name);
        const existing = await prisma_1.prisma.product.findUnique({
            where: { slug },
            select: { id: true },
        });
        if (existing) {
            continue;
        }
        const categoryId = categoryIdByName.get(product.category);
        const subcategoryId = subcategoryIdByPath.get(`${product.category}:${product.subcategory}`);
        if (!categoryId) {
            logger_1.logger.warn({ product: product.name, category: product.category }, "Skipping product with unknown category");
            continue;
        }
        await prisma_1.prisma.product.create({
            data: {
                name: product.name,
                slug,
                description: product.description,
                price: product.price,
                stock: product.stock,
                imageUrl: product.imageUrl,
                isFeatured: product.isFeatured,
                categoryId,
                subcategoryId: subcategoryId ?? null,
            },
        });
        created += 1;
    }
    logger_1.logger.info({ created, total: lowPriceProducts.length }, "Ensured low-price catalog items");
};
exports.ensureLowPriceProducts = ensureLowPriceProducts;
