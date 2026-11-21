import { randomUUID } from "node:crypto";
import app from "../../src/app";
import { createToken } from "../../src/config/token";
import { db } from "../../src/db";

export type Role = "organizer" | "buyer";

export type ApiResult = {
    status: number;
    body: Record<string, unknown> | null;
};

export const request = async (
    method: string,
    path: string,
    options: { token?: string; body?: unknown } = {},
): Promise<ApiResult> => {
    const headers: Record<string, string> = {};

    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    if (options.body !== undefined) headers["Content-Type"] = "application/json";

    const response = await app.request(path, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    const text = await response.text();

    return {
        status: response.status,
        body: text ? (JSON.parse(text) as Record<string, unknown>) : null,
    };
};

export const tokenFor = (userId: string, role: Role) => createToken(userId, role);

export const seedUser = async (role: Role) => {
    const id = randomUUID();

    return await db
        .insertInto("users")
        .values({
            email: `${id}@test.local`,
            name: `Test ${role}`,
            role,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
};

export type SeedTicketType = {
    name: "REGULER" | "VIP";
    price: number;
    quota: number;
};

const defaultTicketTypes: SeedTicketType[] = [
    { name: "REGULER", price: 100_000, quota: 10 },
    { name: "VIP", price: 250_000, quota: 5 },
];

export const seedEventWithTickets = async (
    organizerId: string,
    ticketTypes: SeedTicketType[] = defaultTicketTypes,
) => {
    const event = await db
        .insertInto("events")
        .values({
            organizer_id: organizerId,
            title: `Test Event ${randomUUID()}`,
            description: "test event",
            venue: "Test Venue",
            starts_at: new Date(Date.now() + 86_400_000),
        })
        .returningAll()
        .executeTakeFirstOrThrow();

    const types = await db
        .insertInto("ticket_types")
        .values(ticketTypes.map((ticket) => ({ ...ticket, event_id: event.id })))
        .returningAll()
        .execute();

    return { event, ticketTypes: types };
};

export const createOrder = async (
    eventId: string,
    token: string,
    orders: { type_name: "REGULER" | "VIP"; quantity: number }[],
) => await request("POST", `/api/events/${eventId}/orders`, { token, body: { orders } });
