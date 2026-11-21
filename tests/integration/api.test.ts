import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { expireStaleOrders } from "../../src/modules/orders/orders.service";
import {
    type ApiResult,
    createOrder,
    request,
    seedEventWithTickets,
    seedUser,
    tokenFor,
} from "../helpers/api";
import { bootstrapTestDb, db, hasTestDb, teardownTestDb, truncateAll } from "../helpers/db";

const asRecord = (value: unknown): Record<string, unknown> =>
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

const dataOf = (result: ApiResult) => asRecord(result.body?.data);
const errorCode = (result: ApiResult) => String(asRecord(result.body?.error).code ?? "");
const itemsOf = (order: Record<string, unknown>) => order.items as Record<string, unknown>[];
const ticketsOf = (item: Record<string, unknown>) => item.tickets as Record<string, unknown>[];

const reservedFor = async (eventId: string) => {
    const rows = await db
        .selectFrom("ticket_types")
        .select(["name", "reserved"])
        .where("event_id", "=", eventId)
        .execute();

    return Object.fromEntries(rows.map((row) => [row.name, row.reserved]));
};

const buyerQuota = async (eventId: string, userId: string) => {
    const row = await db
        .selectFrom("buyer_event_quota")
        .select("ticket_count")
        .where("event_id", "=", eventId)
        .where("user_id", "=", userId)
        .executeTakeFirst();

    return row?.ticket_count ?? 0;
};

const orderStatus = async (orderId: string) => {
    const row = await db
        .selectFrom("orders")
        .select("status")
        .where("id", "=", orderId)
        .executeTakeFirstOrThrow();

    return row.status;
};

const ticketsForOrder = async (orderId: string) => {
    return await db
        .selectFrom("tickets")
        .innerJoin("order_items", "order_items.id", "tickets.order_item_id")
        .select(["tickets.id", "tickets.seq", "tickets.code"])
        .where("order_items.order_id", "=", orderId)
        .orderBy("tickets.seq")
        .execute();
};

afterAll(teardownTestDb);

describe.skipIf(!hasTestDb)("API integration", () => {
    beforeAll(bootstrapTestDb);
    beforeEach(truncateAll);

    const setup = async (ticketTypes?: Parameters<typeof seedEventWithTickets>[1]) => {
        const organizer = await seedUser("organizer");
        const buyer = await seedUser("buyer");
        const { event } = await seedEventWithTickets(organizer.id, ticketTypes);

        return {
            organizer,
            buyer,
            event,
            organizerToken: await tokenFor(organizer.id, "organizer"),
            buyerToken: await tokenFor(buyer.id, "buyer"),
        };
    };

    describe("auth", () => {
        test("logs in an existing user", async () => {
            const buyer = await seedUser("buyer");
            const result = await request("POST", "/api/auth/login", {
                body: { email: buyer.email, role: "buyer" },
            });

            expect(result.status).toBe(200);
            expect(typeof result.body?.data).toBe("string");
            expect(String(result.body?.data).length).toBeGreaterThan(0);
        });

        test("returns USER_NOT_FOUND for unknown users", async () => {
            const result = await request("POST", "/api/auth/login", {
                body: { email: "nobody@test.local", role: "buyer" },
            });

            expect(result.status).toBe(404);
            expect(errorCode(result)).toBe("USER_NOT_FOUND");
        });

        test("rejects a protected route without a token", async () => {
            const result = await request("GET", "/api/orders");

            expect(result.status).toBe(401);
            expect(errorCode(result)).toBe("UNAUTHORIZED");
        });
    });

    describe("events", () => {
        test("lists events publicly", async () => {
            const { event } = await setup();
            const result = await request("GET", "/api/events");

            expect(result.status).toBe(200);
            const list = dataOf(result) as unknown as Record<string, unknown>[];
            expect(list.some((item) => item.id === event.id)).toBe(true);
        });

        test("returns public detail with remaining quota", async () => {
            const { event } = await setup();
            const result = await request("GET", `/api/events/${event.id}`);

            expect(result.status).toBe(200);
            const detail = dataOf(result);
            const types = detail.ticket_types as Record<string, unknown>[];
            expect(types).toHaveLength(2);
            expect(types.every((type) => typeof type.remaining === "number")).toBe(true);
        });

        test("returns EVENT_NOT_FOUND for unknown events", async () => {
            const result = await request("GET", `/api/events/${randomUUID()}`);

            expect(result.status).toBe(404);
            expect(errorCode(result)).toBe("EVENT_NOT_FOUND");
        });
    });

    describe("organizer events", () => {
        test("creates an event", async () => {
            const organizer = await seedUser("organizer");
            const token = await tokenFor(organizer.id, "organizer");
            const result = await request("POST", "/api/organizer/events", {
                token,
                body: {
                    title: "Organizer Event",
                    venue: "Jakarta",
                    starts_at: new Date(Date.now() + 86_400_000).toISOString(),
                    tickets: [
                        { type_name: "REGULER", price: 100_000, quota: 10 },
                        { type_name: "VIP", price: 250_000, quota: 5 },
                    ],
                },
            });

            expect(result.status).toBe(201);
            expect((dataOf(result).ticket_types as unknown[]).length).toBe(2);
        });

        test("returns organizer detail for the owner", async () => {
            const { event, organizerToken } = await setup();
            const result = await request("GET", `/api/organizer/events/${event.id}`, {
                token: organizerToken,
            });

            expect(result.status).toBe(200);
            const types = dataOf(result).ticket_types as Record<string, unknown>[];
            expect(types.every((type) => type.sold === 0)).toBe(true);
        });

        test("hides another organizer's event", async () => {
            const { event } = await setup();
            const otherOrganizer = await seedUser("organizer");
            const otherToken = await tokenFor(otherOrganizer.id, "organizer");
            const result = await request("GET", `/api/organizer/events/${event.id}`, {
                token: otherToken,
            });

            expect(result.status).toBe(404);
            expect(errorCode(result)).toBe("EVENT_NOT_FOUND");
        });
    });

    describe("order creation", () => {
        test("creates a nested order and reserves quota", async () => {
            const { event, buyer, buyerToken } = await setup();
            const result = await createOrder(event.id, buyerToken, [
                { type_name: "REGULER", quantity: 2 },
                { type_name: "VIP", quantity: 1 },
            ]);

            expect(result.status).toBe(201);
            const order = dataOf(result);
            expect(order.status).toBe("pending");
            expect(order.total_amount).toBe(450_000);
            expect((order.order_items as unknown[]).length).toBe(2);
            expect(await reservedFor(event.id)).toEqual({ REGULER: 2, VIP: 1 });
            expect(await buyerQuota(event.id, buyer.id)).toBe(3);
        });

        test("returns EVENT_NOT_FOUND for an unknown event", async () => {
            const { buyerToken } = await setup();
            const result = await createOrder(randomUUID(), buyerToken, [
                { type_name: "REGULER", quantity: 1 },
            ]);

            expect(result.status).toBe(404);
            expect(errorCode(result)).toBe("EVENT_NOT_FOUND");
        });

        test("returns TICKET_TYPE_NOT_FOUND when the event lacks the type", async () => {
            const { event, buyerToken } = await setup([
                { name: "REGULER", price: 100_000, quota: 10 },
            ]);
            const result = await createOrder(event.id, buyerToken, [
                { type_name: "VIP", quantity: 1 },
            ]);

            expect(result.status).toBe(404);
            expect(errorCode(result)).toBe("TICKET_TYPE_NOT_FOUND");
        });

        test("returns QUOTA_EXCEEDED when remaining seats are insufficient", async () => {
            const { event, buyerToken } = await setup([
                { name: "REGULER", price: 100_000, quota: 1 },
                { name: "VIP", price: 250_000, quota: 5 },
            ]);
            const result = await createOrder(event.id, buyerToken, [
                { type_name: "REGULER", quantity: 2 },
            ]);

            expect(result.status).toBe(409);
            expect(errorCode(result)).toBe("QUOTA_EXCEEDED");
        });

        test("returns BUYER_LIMIT_EXCEEDED above four tickets", async () => {
            const { event, buyerToken } = await setup();
            const result = await createOrder(event.id, buyerToken, [
                { type_name: "REGULER", quantity: 5 },
            ]);

            expect(result.status).toBe(409);
            expect(errorCode(result)).toBe("BUYER_LIMIT_EXCEEDED");
        });

        test("rejects duplicate ticket types in one order", async () => {
            const { event, buyerToken } = await setup();
            const result = await createOrder(event.id, buyerToken, [
                { type_name: "REGULER", quantity: 1 },
                { type_name: "REGULER", quantity: 1 },
            ]);

            expect(result.status).toBe(400);
            expect(errorCode(result)).toBe("VALIDATION_ERROR");
        });

        test("rejects quantity zero at the validator layer", async () => {
            const { event, buyerToken } = await setup();
            const result = await createOrder(event.id, buyerToken, [
                { type_name: "REGULER", quantity: 0 },
            ]);

            expect(result.status).toBe(400);
            expect(errorCode(result)).toBe("VALIDATION_ERROR");
        });
    });

    describe("pay", () => {
        test("pays and issues sequential tickets without touching reserved", async () => {
            const { event, buyerToken } = await setup();
            const created = await createOrder(event.id, buyerToken, [
                { type_name: "REGULER", quantity: 2 },
                { type_name: "VIP", quantity: 1 },
            ]);
            const orderId = dataOf(created).id as string;

            const result = await request("POST", `/api/orders/${orderId}/pay`, {
                token: buyerToken,
            });

            expect(result.status).toBe(200);
            const order = dataOf(result);
            expect(order.status).toBe("paid");
            expect(order.paid_at).not.toBeNull();
            const allTickets = itemsOf(order).flatMap(ticketsOf);
            expect(allTickets).toHaveLength(3);
            expect(
                allTickets.every((ticket) => /^TKT-[0-9a-f-]{36}$/i.test(String(ticket.code))),
            ).toBe(true);
            expect(await reservedFor(event.id)).toEqual({ REGULER: 2, VIP: 1 });
        });

        test("rejects a second payment", async () => {
            const { event, buyerToken } = await setup();
            const created = await createOrder(event.id, buyerToken, [
                { type_name: "REGULER", quantity: 1 },
            ]);
            const orderId = dataOf(created).id as string;

            await request("POST", `/api/orders/${orderId}/pay`, { token: buyerToken });
            const result = await request("POST", `/api/orders/${orderId}/pay`, {
                token: buyerToken,
            });

            expect(result.status).toBe(410);
            expect(errorCode(result)).toBe("ORDER_NOT_PENDING");
        });

        test("hides another buyer's order", async () => {
            const { event, buyerToken } = await setup();
            const other = await seedUser("buyer");
            const otherToken = await tokenFor(other.id, "buyer");
            const created = await createOrder(event.id, buyerToken, [
                { type_name: "REGULER", quantity: 1 },
            ]);
            const orderId = dataOf(created).id as string;

            const result = await request("POST", `/api/orders/${orderId}/pay`, {
                token: otherToken,
            });

            expect(result.status).toBe(404);
            expect(errorCode(result)).toBe("ORDER_NOT_FOUND");
        });

        test("lazily expires a stale order and releases quota", async () => {
            const { event, buyer, buyerToken } = await setup();
            const created = await createOrder(event.id, buyerToken, [
                { type_name: "VIP", quantity: 1 },
            ]);
            const orderId = dataOf(created).id as string;

            await db
                .updateTable("orders")
                .set({ expires_at: new Date(Date.now() - 60_000) })
                .where("id", "=", orderId)
                .execute();

            const result = await request("POST", `/api/orders/${orderId}/pay`, {
                token: buyerToken,
            });

            expect(result.status).toBe(410);
            expect(errorCode(result)).toBe("ORDER_NOT_PENDING");
            expect(await orderStatus(orderId)).toBe("expired");
            expect((await reservedFor(event.id)).VIP).toBe(0);
            expect(await buyerQuota(event.id, buyer.id)).toBe(0);
            expect(await ticketsForOrder(orderId)).toHaveLength(0);
        });
    });

    describe("cancel", () => {
        test("cancels a pending order and releases quota", async () => {
            const { event, buyer, buyerToken } = await setup();
            const created = await createOrder(event.id, buyerToken, [
                { type_name: "REGULER", quantity: 2 },
                { type_name: "VIP", quantity: 1 },
            ]);
            const orderId = dataOf(created).id as string;

            const result = await request("POST", `/api/orders/${orderId}/cancel`, {
                token: buyerToken,
            });

            expect(result.status).toBe(200);
            expect(dataOf(result).status).toBe("cancelled");
            expect(dataOf(result).cancelled_at).not.toBeNull();
            expect(await reservedFor(event.id)).toEqual({ REGULER: 0, VIP: 0 });
            expect(await buyerQuota(event.id, buyer.id)).toBe(0);
        });

        test("rejects a second cancel", async () => {
            const { event, buyerToken } = await setup();
            const created = await createOrder(event.id, buyerToken, [
                { type_name: "REGULER", quantity: 1 },
            ]);
            const orderId = dataOf(created).id as string;

            await request("POST", `/api/orders/${orderId}/cancel`, { token: buyerToken });
            const result = await request("POST", `/api/orders/${orderId}/cancel`, {
                token: buyerToken,
            });

            expect(result.status).toBe(410);
            expect(errorCode(result)).toBe("ORDER_NOT_PENDING");
        });

        test("hides another buyer's order", async () => {
            const { event, buyerToken } = await setup();
            const other = await seedUser("buyer");
            const otherToken = await tokenFor(other.id, "buyer");
            const created = await createOrder(event.id, buyerToken, [
                { type_name: "REGULER", quantity: 1 },
            ]);
            const orderId = dataOf(created).id as string;

            const result = await request("POST", `/api/orders/${orderId}/cancel`, {
                token: otherToken,
            });

            expect(result.status).toBe(404);
            expect(errorCode(result)).toBe("ORDER_NOT_FOUND");
            expect(await orderStatus(orderId)).toBe("pending");
        });

        test("cannot cancel after paying", async () => {
            const { event, buyer, buyerToken } = await setup();
            const created = await createOrder(event.id, buyerToken, [
                { type_name: "VIP", quantity: 1 },
            ]);
            const orderId = dataOf(created).id as string;

            await request("POST", `/api/orders/${orderId}/pay`, { token: buyerToken });
            const result = await request("POST", `/api/orders/${orderId}/cancel`, {
                token: buyerToken,
            });

            expect(result.status).toBe(410);
            expect(await orderStatus(orderId)).toBe("paid");
            expect((await ticketsForOrder(orderId)).length).toBe(1);
            expect(await buyerQuota(event.id, buyer.id)).toBe(1);
        });

        test("cancelling first blocks the later pay", async () => {
            const { event, buyerToken } = await setup();
            const created = await createOrder(event.id, buyerToken, [
                { type_name: "REGULER", quantity: 1 },
            ]);
            const orderId = dataOf(created).id as string;

            await request("POST", `/api/orders/${orderId}/cancel`, { token: buyerToken });
            const result = await request("POST", `/api/orders/${orderId}/pay`, {
                token: buyerToken,
            });

            expect(result.status).toBe(410);
            expect(await orderStatus(orderId)).toBe("cancelled");
            expect(await ticketsForOrder(orderId)).toHaveLength(0);
        });

        test("lazily expires a stale order instead of cancelling", async () => {
            const { event, buyer, buyerToken } = await setup();
            const created = await createOrder(event.id, buyerToken, [
                { type_name: "VIP", quantity: 1 },
            ]);
            const orderId = dataOf(created).id as string;

            await db
                .updateTable("orders")
                .set({ expires_at: new Date(Date.now() - 60_000) })
                .where("id", "=", orderId)
                .execute();

            const result = await request("POST", `/api/orders/${orderId}/cancel`, {
                token: buyerToken,
            });

            expect(result.status).toBe(410);
            expect(await orderStatus(orderId)).toBe("expired");
            expect((await reservedFor(event.id)).VIP).toBe(0);
            expect(await buyerQuota(event.id, buyer.id)).toBe(0);
        });
    });

    describe("order reads", () => {
        test("lists and reads the buyer's nested orders", async () => {
            const { event, buyerToken } = await setup();
            const first = await createOrder(event.id, buyerToken, [
                { type_name: "REGULER", quantity: 1 },
            ]);
            await createOrder(event.id, buyerToken, [{ type_name: "VIP", quantity: 1 }]);

            const list = await request("GET", "/api/orders", { token: buyerToken });
            expect(list.status).toBe(200);
            const orders = dataOf(list) as unknown as Record<string, unknown>[];
            expect(orders).toHaveLength(2);
            expect(orders.every((order) => Array.isArray(order.items))).toBe(true);

            const detail = await request("GET", `/api/orders/${dataOf(first).id}`, {
                token: buyerToken,
            });
            expect(detail.status).toBe(200);
            expect(itemsOf(dataOf(detail))).toHaveLength(1);
            expect(ticketsOf(itemsOf(dataOf(detail))[0] as Record<string, unknown>)).toHaveLength(
                0,
            );
        });

        test("hides another buyer's order detail", async () => {
            const { event, buyerToken } = await setup();
            const other = await seedUser("buyer");
            const otherToken = await tokenFor(other.id, "buyer");
            const created = await createOrder(event.id, buyerToken, [
                { type_name: "REGULER", quantity: 1 },
            ]);

            const result = await request("GET", `/api/orders/${dataOf(created).id}`, {
                token: otherToken,
            });

            expect(result.status).toBe(404);
            expect(errorCode(result)).toBe("ORDER_NOT_FOUND");
        });
    });

    describe("concurrency", () => {
        test("only one of two racing buyers gets the last seat", async () => {
            const organizer = await seedUser("organizer");
            const buyerA = await seedUser("buyer");
            const buyerB = await seedUser("buyer");
            const { event } = await seedEventWithTickets(organizer.id, [
                { name: "REGULER", price: 100_000, quota: 1 },
                { name: "VIP", price: 250_000, quota: 5 },
            ]);
            const tokenA = await tokenFor(buyerA.id, "buyer");
            const tokenB = await tokenFor(buyerB.id, "buyer");

            const results = await Promise.all([
                createOrder(event.id, tokenA, [{ type_name: "REGULER", quantity: 1 }]),
                createOrder(event.id, tokenB, [{ type_name: "REGULER", quantity: 1 }]),
            ]);
            const statuses = results.map((result) => result.status).sort();

            expect(statuses).toEqual([201, 409]);
            expect(results.find((result) => result.status === 409)).toBeDefined();
            expect(errorCode(results.find((result) => result.status === 409) as ApiResult)).toBe(
                "QUOTA_EXCEEDED",
            );
            expect((await reservedFor(event.id)).REGULER).toBe(1);
        });

        test("same buyer cannot exceed the limit via parallel orders", async () => {
            const { event, buyer, buyerToken } = await setup();

            const results = await Promise.all([
                createOrder(event.id, buyerToken, [{ type_name: "REGULER", quantity: 3 }]),
                createOrder(event.id, buyerToken, [{ type_name: "REGULER", quantity: 3 }]),
            ]);
            const statuses = results.map((result) => result.status).sort();

            expect(statuses).toEqual([201, 409]);
            expect(errorCode(results.find((result) => result.status === 409) as ApiResult)).toBe(
                "BUYER_LIMIT_EXCEEDED",
            );
            expect(await buyerQuota(event.id, buyer.id)).toBe(3);
        });

        test("parallel pays issue tickets exactly once", async () => {
            const { event, buyerToken } = await setup();
            const created = await createOrder(event.id, buyerToken, [
                { type_name: "VIP", quantity: 1 },
            ]);
            const orderId = dataOf(created).id as string;

            const results = await Promise.all([
                request("POST", `/api/orders/${orderId}/pay`, { token: buyerToken }),
                request("POST", `/api/orders/${orderId}/pay`, { token: buyerToken }),
            ]);
            const statuses = results.map((result) => result.status).sort();

            expect(statuses).toEqual([200, 410]);
            expect(await ticketsForOrder(orderId)).toHaveLength(1);
        });
    });

    describe("expiry sweeper", () => {
        const expireInPast = async (orderIds: string[]) => {
            await db
                .updateTable("orders")
                .set({ expires_at: new Date(Date.now() - 60_000) })
                .where("id", "in", orderIds)
                .execute();
        };

        test("expires a stale pending order and releases quota", async () => {
            const { event, buyer, buyerToken } = await setup();
            const created = await createOrder(event.id, buyerToken, [
                { type_name: "VIP", quantity: 1 },
            ]);
            const orderId = dataOf(created).id as string;
            await expireInPast([orderId]);

            expect(await expireStaleOrders(100)).toBe(1);
            expect(await orderStatus(orderId)).toBe("expired");
            expect((await reservedFor(event.id)).VIP).toBe(0);
            expect(await buyerQuota(event.id, buyer.id)).toBe(0);
            expect(await ticketsForOrder(orderId)).toHaveLength(0);
        });

        test("leaves fresh pending and paid orders untouched", async () => {
            const { event, buyer, buyerToken } = await setup();
            const fresh = await createOrder(event.id, buyerToken, [
                { type_name: "REGULER", quantity: 1 },
            ]);
            const paid = await createOrder(event.id, buyerToken, [
                { type_name: "REGULER", quantity: 1 },
            ]);
            const paidId = dataOf(paid).id as string;
            await request("POST", `/api/orders/${paidId}/pay`, { token: buyerToken });
            await expireInPast([paidId]);

            expect(await expireStaleOrders(100)).toBe(0);
            expect(await orderStatus(dataOf(fresh).id as string)).toBe("pending");
            expect(await orderStatus(paidId)).toBe("paid");
            expect((await reservedFor(event.id)).REGULER).toBe(2);
            expect(await buyerQuota(event.id, buyer.id)).toBe(2);
        });

        test("respects the batch limit and is idempotent", async () => {
            const { event, buyer, buyerToken } = await setup();
            const orderIds: string[] = [];

            for (let index = 0; index < 3; index += 1) {
                const created = await createOrder(event.id, buyerToken, [
                    { type_name: "REGULER", quantity: 1 },
                ]);
                orderIds.push(dataOf(created).id as string);
            }

            await expireInPast(orderIds);

            expect(await expireStaleOrders(2)).toBe(2);
            expect(await expireStaleOrders(2)).toBe(1);
            expect(await expireStaleOrders(2)).toBe(0);

            for (const orderId of orderIds) {
                expect(await orderStatus(orderId)).toBe("expired");
            }
            expect((await reservedFor(event.id)).REGULER).toBe(0);
            expect(await buyerQuota(event.id, buyer.id)).toBe(0);
        });

        test("parallel sweeps expire each order exactly once", async () => {
            const { event, buyer, buyerToken } = await setup();
            const orderIds: string[] = [];

            for (let index = 0; index < 4; index += 1) {
                const created = await createOrder(event.id, buyerToken, [
                    { type_name: "REGULER", quantity: 1 },
                ]);
                orderIds.push(dataOf(created).id as string);
            }

            await expireInPast(orderIds);

            const [first, second] = await Promise.all([
                expireStaleOrders(10),
                expireStaleOrders(10),
            ]);

            expect(first + second).toBe(4);
            for (const orderId of orderIds) {
                expect(await orderStatus(orderId)).toBe("expired");
            }
            expect((await reservedFor(event.id)).REGULER).toBe(0);
            expect(await buyerQuota(event.id, buyer.id)).toBe(0);
        });
    });
});
