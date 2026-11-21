import { describe, expect, test } from "bun:test";
import {
    orderSchema,
    orderTicketSchema,
    ticketSchema,
} from "../../src/modules/orders/orders.schema";

const now = new Date("2026-12-01T10:00:00.000Z");

const validTicket = {
    id: "ticket-1",
    order_item_id: "item-1",
    code: "TKT-0123",
    seq: 1,
    issued_at: now,
};

const validOrder = {
    id: "order-1",
    status: "paid",
    total_amount: 450_000,
    expires_at: now,
    paid_at: now,
    cancelled_at: null,
    created_at: now,
    event: {
        id: "event-1",
        title: "Concert",
        venue: "Jakarta",
        starts_at: now,
    },
    items: [
        {
            id: "item-1",
            ticket_type_id: "type-1",
            ticket_type_name: "REGULER",
            quantity: 1,
            unit_price: 100_000,
            tickets: [validTicket],
        },
    ],
};

describe("orderTicketSchema", () => {
    test("accepts valid order items", () => {
        const result = orderTicketSchema.safeParse({
            orders: [
                { type_name: "REGULER", quantity: 2 },
                { type_name: "VIP", quantity: 1 },
            ],
        });

        expect(result.success).toBe(true);
    });

    test("rejects quantity below 1", () => {
        const result = orderTicketSchema.safeParse({
            orders: [{ type_name: "REGULER", quantity: 0 }],
        });

        expect(result.success).toBe(false);
    });

    test("rejects a non-integer quantity", () => {
        const result = orderTicketSchema.safeParse({
            orders: [{ type_name: "REGULER", quantity: 1.5 }],
        });

        expect(result.success).toBe(false);
    });

    test("rejects an unknown ticket type", () => {
        const result = orderTicketSchema.safeParse({
            orders: [{ type_name: "GOLD", quantity: 1 }],
        });

        expect(result.success).toBe(false);
    });
});

describe("ticketSchema", () => {
    test("accepts a valid ticket", () => {
        expect(ticketSchema.safeParse(validTicket).success).toBe(true);
    });

    test("rejects a non-integer seq", () => {
        expect(ticketSchema.safeParse({ ...validTicket, seq: 1.5 }).success).toBe(false);
    });
});

describe("orderSchema", () => {
    test("accepts a nested order fixture", () => {
        expect(orderSchema.safeParse(validOrder).success).toBe(true);
    });

    test("rejects a non-integer unit_price", () => {
        const result = orderSchema.safeParse({
            ...validOrder,
            items: [{ ...validOrder.items[0], unit_price: 100_000.5 }],
        });

        expect(result.success).toBe(false);
    });

    test("rejects a missing event", () => {
        const { event: _event, ...withoutEvent } = validOrder;
        const result = orderSchema.safeParse(withoutEvent);

        expect(result.success).toBe(false);
    });
});
