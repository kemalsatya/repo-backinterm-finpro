import type { Context } from "hono";
import type { JwtVariables } from "hono/jwt";
import { AppError } from "../../utils/app-error";
import { successResponse } from "../../utils/response";
import * as eventServices from "./events.service";

type EventDetailContext = Context<{ Variables: JwtVariables }, "/:eventId">;
type OrderTicketContext = Context<{ Variables: JwtVariables }, "/:eventId/orders">;

export const listAllEventsHandler = async (c: Context) => {
    const allEvents = await eventServices.findAllEvents();
    if (allEvents.length < 1) throw new AppError("EVENT_NOT_FOUND", "There is no event");
    return successResponse(c, allEvents, "Event retrieved");
};

export const seekEventByIdHandler = async (c: EventDetailContext) => {
    const event = await eventServices.getPublicDetailedEvent(c.req.param("eventId"));
    return successResponse(c, event, "Event retrieved");
};

export const tickerOrderHandler = async (c: OrderTicketContext) => {
    const payload = c.get("jwtPayload");

    if (!payload) {
        throw new AppError("UNAUTHORIZED", "Need Login");
    }

    const body = await c.req.json();

    const ticketOrder = await eventServices.insertOrderedTickets(
        c.req.param("eventId"),
        payload.userId as string,
        body,
    );
    return successResponse(c, ticketOrder, "Order events success", 201);
};
