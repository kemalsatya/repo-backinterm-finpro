import type { Context } from "hono";
import { createToken } from "../../config/token";
import type { login } from "./auth.schemas";
import * as authServices from "./auth.services";

export const loginHandler = async (c: Context) => {
    const body: login = await c.req.json();
    const { email, role } = body;
    const userData = await authServices.findUser(email, role);
    const token = await createToken(userData.id, role);
    return c.json({
        success: true,
        data: token,
    });
};
