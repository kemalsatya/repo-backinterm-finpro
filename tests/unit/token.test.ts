import { describe, expect, test } from "bun:test";
import { verify } from "hono/jwt";
import { ENV } from "../../src/config/env";
import { createToken } from "../../src/config/token";

describe("createToken", () => {
    test("signs a verifiable 15-minute token", async () => {
        const before = Math.floor(Date.now() / 1000);
        const token = await createToken("user-1", "buyer");
        const payload = await verify(token, ENV.jwt_secret, ENV.jwt_alg);

        expect(payload.userId).toBe("user-1");
        expect(payload.role).toBe("buyer");

        const exp = payload.exp as number;
        expect(exp - before).toBeGreaterThanOrEqual(899);
        expect(exp - before).toBeLessThanOrEqual(901);
    });
});
