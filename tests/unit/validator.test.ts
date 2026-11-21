import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { orderTicketSchema } from "../../src/modules/orders/orders.schema";
import { validator } from "../../src/utils/validator";

const app = new Hono();

app.post("/validated", validator("json", orderTicketSchema), (c) => c.json({ success: true }));

const post = (body: unknown) =>
    app.request("/validated", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });

describe("validator", () => {
    test("passes a valid body through", async () => {
        const response = await post({ orders: [{ type_name: "VIP", quantity: 1 }] });

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ success: true });
    });

    test("returns the standard validation error envelope", async () => {
        const response = await post({ orders: [{ type_name: "VIP", quantity: 0 }] });
        const body = (await response.json()) as { error: { code: string; message: string } };

        expect(response.status).toBe(400);
        expect(body.error.code).toBe("VALIDATION_ERROR");
        expect(body.error.message).toContain("orders.0.quantity");
    });
});
