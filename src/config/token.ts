import { sign } from "hono/jwt";
import { ENV } from "./env";

export const createToken = async (userId: string, role: string) => {
    const payload = {
        userId: userId,
        role: role,
        exp: Math.floor(Date.now() / 1000) + 60 * 15, // Token expires in 15 minutes
    };
    const secret = ENV.jwt_secret;
    const token = await sign(payload, secret);
    return token;
};
