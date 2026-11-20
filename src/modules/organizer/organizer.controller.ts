import type { Context } from "hono";
import type { JwtVariables } from "hono/jwt";
import { AppError } from "../../utils/app-error";
import { successResponse } from "../../utils/response";
import type { createEventDTO } from "../events/events.contract";
import { getOrganizerEvent, insertEvent } from "../events/events.contract";

type OrganizerContext = Context<{ Variables: JwtVariables }>;
type OrganizerEventContext = Context<{ Variables: JwtVariables }, "/events/:eventId">;

export const createEventHandler = async (c: OrganizerContext) => {
    const payload = c.get("jwtPayload");

    if (payload?.role !== "organizer") {
        throw new AppError("UNAUTHORIZED", "Only organizers can create events");
    }

    const body: createEventDTO = await c.req.json();
    const createdEvent = await insertEvent(payload.userId as string, body);

    return successResponse(c, createdEvent, "Event created", 201);
};

export const seekEventByIdHandler = async (c: OrganizerEventContext) => {
    const payload = c.get("jwtPayload");

    if (payload?.role !== "organizer") {
        throw new AppError("UNAUTHORIZED", "Only organizers can access this resource");
    }

    const eventFullData = await getOrganizerEvent(c.req.param("eventId"), payload.userId as string);

    return successResponse(c, eventFullData, "Event retrieved");
};
