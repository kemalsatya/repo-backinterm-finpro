import type { Context, Env } from "hono";
import { AppError } from "../../utils/app-error";
import { successResponse } from "../../utils/response";
import * as eventServices from "./events.service";

type EventDetailContext = Context<Env, "/:eventId">;

export const listAllEventsHandler = async (c: Context) => {
    const allEvents = await eventServices.findAllEvents();
    if (allEvents.length < 1) throw new AppError("EVENT_NOT_FOUND", "There is no event");
    return successResponse(c, allEvents, "Events have been taken");
};

export const seekEventByIdHandler = async (c: EventDetailContext) => {
    const event = await eventServices.getPublicDetailedEvent(c.req.param("eventId"));
    return successResponse(c, event, "Event retrieved");
};
