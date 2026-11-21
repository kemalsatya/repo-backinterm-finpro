import { Hono } from "hono";
import { jwt } from "hono/jwt";
import { ENV } from "../../config/env";
import * as ordersController from "./orders.controller";

const route = new Hono();

route.use(jwt({ secret: ENV.jwt_secret, alg: ENV.jwt_alg }));

route.get("/", ordersController.listOrdersHandler);
route.get("/:orderId", ordersController.getOrderDetailHandler);
route.post("/:orderId/pay", ordersController.payOrderHandler);
route.post("/:orderId/cancel", ordersController.cancelOrderHandler);

export default route;
