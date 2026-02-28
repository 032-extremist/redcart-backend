import { Router } from "express";
import authRoutes from "../modules/auth/auth.routes";
import usersRoutes from "../modules/users/users.routes";
import catalogRoutes from "../modules/catalog/catalog.routes";
import cartRoutes from "../modules/cart/cart.routes";
import ordersRoutes from "../modules/orders/orders.routes";
import paymentsRoutes from "../modules/payments/payments.routes";
import adminRoutes from "../modules/admin/admin.routes";
import reviewsRoutes from "../modules/reviews/reviews.routes";
import wishlistRoutes from "../modules/wishlist/wishlist.routes";
import aiRoutes from "../modules/ai/ai.routes";
import receiptsRoutes from "../modules/receipts/receipts.routes";

const router = Router();

router.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "RedCart API" });
});

router.use("/auth", authRoutes);
router.use("/users", usersRoutes);
router.use("/catalog", catalogRoutes);
router.use("/cart", cartRoutes);
router.use("/orders", ordersRoutes);
router.use("/payments", paymentsRoutes);
router.use("/admin", adminRoutes);
router.use("/reviews", reviewsRoutes);
router.use("/wishlist", wishlistRoutes);
router.use("/ai", aiRoutes);
router.use("/receipts", receiptsRoutes);

export default router;
