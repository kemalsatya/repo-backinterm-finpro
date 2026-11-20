import { Hono } from "hono";
import * as eventsController from "./events.controller";

const route = new Hono();

route.get("/", eventsController.listAllEventsHandler);
route.get("/:eventId", eventsController.seekEventByIdHandler);

export default route;
