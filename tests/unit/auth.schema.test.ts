import { describe, expect, test } from "bun:test";
import { loginSchema } from "../../src/modules/auth/auth.schema";

describe("loginSchema", () => {
    test("accepts a valid buyer login", () => {
        const result = loginSchema.safeParse({ email: "buyer@example.com", role: "buyer" });

        expect(result.success).toBe(true);
    });

    test("accepts a valid organizer login", () => {
        const result = loginSchema.safeParse({ email: "org@example.com", role: "organizer" });

        expect(result.success).toBe(true);
    });

    test("rejects an invalid email", () => {
        const result = loginSchema.safeParse({ email: "not-an-email", role: "buyer" });

        expect(result.success).toBe(false);
    });

    test("rejects an unknown role", () => {
        const result = loginSchema.safeParse({ email: "buyer@example.com", role: "admin" });

        expect(result.success).toBe(false);
    });

    test("rejects a missing role", () => {
        const result = loginSchema.safeParse({ email: "buyer@example.com" });

        expect(result.success).toBe(false);
    });
});
