import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { errorResponse, successResponse } from "../../src/utils/response";

const app = new Hono();

app.get("/success", (c) => successResponse(c, { id: "1" }));
app.get("/created", (c) => successResponse(c, { id: "1" }, "Created", 201));
app.get("/error", (c) => errorResponse(c, "ORDER_NOT_FOUND", "Order not found", 404));

describe("successResponse", () => {
    test("wraps data with default message and status", async () => {
        const response = await app.request("/success");

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            success: true,
            message: "Success",
            data: { id: "1" },
        });
    });

    test("supports a custom message and status", async () => {
        const response = await app.request("/created");

        expect(response.status).toBe(201);
        expect(await response.json()).toEqual({
            success: true,
            message: "Created",
            data: { id: "1" },
        });
    });
});

describe("errorResponse", () => {
    test("uses the standard error envelope", async () => {
        const response = await app.request("/error");

        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({
            error: { code: "ORDER_NOT_FOUND", message: "Order not found" },
        });
    });
});
