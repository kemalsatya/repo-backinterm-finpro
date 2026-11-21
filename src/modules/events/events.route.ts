import { Hono } from "hono";
import { jwt } from "hono/jwt";
import { ENV } from "../../config/env";
import { validator } from "../../utils/validator";
import { orderTicketSchema } from "../orders/orders.contract";
import * as eventsController from "./events.controller";

const route = new Hono();

route.get("/", eventsController.listAllEventsHandler);
route.get("/:eventId", eventsController.seekEventByIdHandler);

route.post(
    "/:eventId/orders",
    jwt({ secret: ENV.jwt_secret, alg: ENV.jwt_alg }),
    validator("json", orderTicketSchema),
    eventsController.tickerOrderHandler,
);

export default route;
