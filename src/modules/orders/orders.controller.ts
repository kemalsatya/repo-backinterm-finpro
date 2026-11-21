import type { Context } from "hono";
import type { JwtVariables } from "hono/jwt";
import { AppError } from "../../utils/app-error";
import { successResponse } from "../../utils/response";
import * as orderService from "./orders.service";

type OrdersContext = Context<{ Variables: JwtVariables }>;
type OrderDetailContext = Context<{ Variables: JwtVariables }, "/:orderId">;
type PayOrderContext = Context<{ Variables: JwtVariables }, "/:orderId/pay">;
type CancelOrderContext = Context<{ Variables: JwtVariables }, "/:orderId/cancel">;

const requireBuyerId = (c: Context<{ Variables: JwtVariables }>) => {
    const payload = c.get("jwtPayload");

    if (payload?.role !== "buyer" || typeof payload.userId !== "string") {
        throw new AppError("UNAUTHORIZED", "Only buyers can access orders");
    }

    return payload.userId;
};

export const listOrdersHandler = async (c: OrdersContext) => {
    const userId = requireBuyerId(c);
    const orders = await orderService.listBuyerOrders(userId);

    return successResponse(c, orders, "Orders retrieved");
};

export const getOrderDetailHandler = async (c: OrderDetailContext) => {
    const userId = requireBuyerId(c);
    const order = await orderService.getBuyerOrderDetail(c.req.param("orderId"), userId);

    return successResponse(c, order, "Order retrieved");
};

export const payOrderHandler = async (c: PayOrderContext) => {
    const userId = requireBuyerId(c);
    const order = await orderService.payOrder(c.req.param("orderId"), userId);

    return successResponse(c, order, "Order paid, tickets issued");
};

export const cancelOrderHandler = async (c: CancelOrderContext) => {
    const userId = requireBuyerId(c);
    const order = await orderService.cancelOrder(c.req.param("orderId"), userId);

    return successResponse(c, order, "Order cancelled");
};
