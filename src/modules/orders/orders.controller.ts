import type { Context } from "hono";
import type { JwtVariables } from "hono/jwt";
import { AppError } from "../../utils/app-error";
import { successResponse } from "../../utils/response";
import * as orderService from "./orders.service";

type OrdersContext = Context<{ Variables: JwtVariables }>;
type OrderDetailContext = Context<{ Variables: JwtVariables }, "/:orderId">;

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
