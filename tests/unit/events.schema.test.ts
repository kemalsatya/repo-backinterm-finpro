import { describe, expect, test } from "bun:test";
import {
    createEventSchema,
    detailedTicketOrderSchema,
} from "../../src/modules/events/events.schema";

const validEvent = {
    title: "Concert",
    description: "A test concert",
    venue: "Jakarta",
    starts_at: "2026-12-01T10:00:00.000Z",
    tickets: [
        { type_name: "REGULER", price: 100_000, quota: 10 },
        { type_name: "VIP", price: 250_000, quota: 5 },
    ],
};

describe("createEventSchema", () => {
    test("accepts one REGULER and one VIP ticket type", () => {
        const result = createEventSchema.safeParse(validEvent);

        expect(result.success).toBe(true);
    });

    test("coerces starts_at strings into Date", () => {
        const result = createEventSchema.safeParse(validEvent);

        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.starts_at).toBeInstanceOf(Date);
        }
    });

    test("rejects duplicate ticket types", () => {
        const result = createEventSchema.safeParse({
            ...validEvent,
            tickets: [
                { type_name: "REGULER", price: 100_000, quota: 10 },
                { type_name: "REGULER", price: 200_000, quota: 5 },
            ],
        });

        expect(result.success).toBe(false);
    });

    test("rejects fewer than two ticket types", () => {
        const result = createEventSchema.safeParse({
            ...validEvent,
            tickets: [{ type_name: "VIP", price: 250_000, quota: 5 }],
        });

        expect(result.success).toBe(false);
    });

    test("rejects a negative price", () => {
        const result = createEventSchema.safeParse({
            ...validEvent,
            tickets: [
                { type_name: "REGULER", price: -1, quota: 10 },
                { type_name: "VIP", price: 250_000, quota: 5 },
            ],
        });

        expect(result.success).toBe(false);
    });

    test("rejects a zero quota", () => {
        const result = createEventSchema.safeParse({
            ...validEvent,
            tickets: [
                { type_name: "REGULER", price: 100_000, quota: 0 },
                { type_name: "VIP", price: 250_000, quota: 5 },
            ],
        });

        expect(result.success).toBe(false);
    });
});

describe("detailedTicketOrderSchema", () => {
    test("accepts a valid item", () => {
        const result = detailedTicketOrderSchema.safeParse({ type_name: "VIP", quantity: 2 });

        expect(result.success).toBe(true);
    });

    test("rejects quantity below 1", () => {
        const result = detailedTicketOrderSchema.safeParse({ type_name: "VIP", quantity: 0 });

        expect(result.success).toBe(false);
    });

    test("rejects an unknown ticket type", () => {
        const result = detailedTicketOrderSchema.safeParse({ type_name: "GOLD", quantity: 1 });

        expect(result.success).toBe(false);
    });
});
