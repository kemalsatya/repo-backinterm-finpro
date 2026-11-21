import { Hono } from "hono";
import authRoutes from "../modules/auth/auth.routes";
import eventRoutes from "../modules/events/events.route";
import orderRoutes from "../modules/orders/orders.route";
import organizerRoutes from "../modules/organizer/organizer.route";

const router = new Hono();

router.route("/auth", authRoutes);
router.route("/organizer", organizerRoutes);
router.route("/events", eventRoutes);
router.route("/orders", orderRoutes);

export default router;
