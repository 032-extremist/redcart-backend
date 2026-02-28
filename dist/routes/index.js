"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_routes_1 = __importDefault(require("../modules/auth/auth.routes"));
const users_routes_1 = __importDefault(require("../modules/users/users.routes"));
const catalog_routes_1 = __importDefault(require("../modules/catalog/catalog.routes"));
const cart_routes_1 = __importDefault(require("../modules/cart/cart.routes"));
const orders_routes_1 = __importDefault(require("../modules/orders/orders.routes"));
const payments_routes_1 = __importDefault(require("../modules/payments/payments.routes"));
const admin_routes_1 = __importDefault(require("../modules/admin/admin.routes"));
const reviews_routes_1 = __importDefault(require("../modules/reviews/reviews.routes"));
const wishlist_routes_1 = __importDefault(require("../modules/wishlist/wishlist.routes"));
const ai_routes_1 = __importDefault(require("../modules/ai/ai.routes"));
const receipts_routes_1 = __importDefault(require("../modules/receipts/receipts.routes"));
const router = (0, express_1.Router)();
router.get("/", (_req, res) => {
    res.json({
        service: "RedCart API",
        health: "/api/v1/health",
    });
});
router.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "RedCart API" });
});
router.use("/auth", auth_routes_1.default);
router.use("/users", users_routes_1.default);
router.use("/catalog", catalog_routes_1.default);
router.use("/cart", cart_routes_1.default);
router.use("/orders", orders_routes_1.default);
router.use("/payments", payments_routes_1.default);
router.use("/admin", admin_routes_1.default);
router.use("/reviews", reviews_routes_1.default);
router.use("/wishlist", wishlist_routes_1.default);
router.use("/ai", ai_routes_1.default);
router.use("/receipts", receipts_routes_1.default);
exports.default = router;
