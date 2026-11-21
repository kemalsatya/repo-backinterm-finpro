import { sign } from "hono/jwt";
import { ENV } from "./env";

export const TOKEN_TTL_SECONDS = 60 * 30; // Token expires in 30 minutes

export const createToken = async (userId: string, role: string) => {
    const payload = {
        userId: userId,
        role: role,
        exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
    };
    const secret = ENV.jwt_secret;
    const token = await sign(payload, secret, ENV.jwt_alg);
    return token;
};
