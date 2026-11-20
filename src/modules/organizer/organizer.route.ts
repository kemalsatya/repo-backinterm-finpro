import { Hono } from "hono";
import { jwt } from "hono/jwt";
import { ENV } from "../../config/env";
import { validator } from "../../utils/validator";
import { createEventSchema } from "../events/events.contract";
import * as organizerController from "./organizer.controller";

const route = new Hono();

route.use(
    jwt({
        secret: ENV.jwt_secret,
        alg: ENV.jwt_alg,
    }),
);

route.post("/events", validator("json", createEventSchema), organizerController.createEventHandler);
route.get("/events/:eventId", organizerController.seekEventByIdHandler);

export default route;
