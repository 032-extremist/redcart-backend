"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.orderAmountToNumber = exports.productToResponse = void 0;
const productToResponse = (product) => ({
    ...product,
    price: Number(product.price),
    category: product.category,
    subcategory: product.subcategory,
});
exports.productToResponse = productToResponse;
const orderAmountToNumber = (order) => ({
    ...order,
    total: Number(order.total),
});
exports.orderAmountToNumber = orderAmountToNumber;
