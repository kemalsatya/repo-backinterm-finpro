import { Hono } from "hono";
import authRoute from "../modules/auth/auth.routes";

const router = new Hono();

//router.route()
router.route("/auth", authRoute);

export default router;
