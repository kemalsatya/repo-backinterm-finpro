import { Hono } from "hono";
import { jwt } from "hono/jwt";
import { zValidator } from "@hono/zod-validator";
import * as authControllers from './auth.controller'
import * as authSchemas from './auth.schemas'

const route = new Hono()

//route.get()

// login
route.post('/login', zValidator('json', authSchemas.loginSchema), authControllers.loginHandler)

export default route