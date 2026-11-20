import { Hono } from "hono";
import { validator } from "../../utils/validator";
import * as authControllers from "./auth.controller";
import * as authSchemas from "./auth.schemas";

const route = new Hono();

//route.get()

// login
route.post("/login", validator("json", authSchemas.loginSchema), authControllers.loginHandler);

export default route;
