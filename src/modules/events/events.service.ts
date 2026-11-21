import { db } from "../../db";
import { AppError } from "../../utils/app-error";
import type { orderTicketDTO } from "../orders/orders.contract";
import type { createEventDTO } from "./events.schema";

export const findAllEvents = async () => {
    return await db
        .selectFrom("events")
        .innerJoin("users", "users.id", "events.organizer_id")
        .select([
            "events.id",
            "events.title",
            "events.description",
            "events.venue",
            "events.starts_at",
            "users.name as organizer_name",
        ])
        .execute();
};

export const getPublicDetailedEvent = async (eventId: string) => {
    const event = await db
        .selectFrom("events")
        .innerJoin("users", "users.id", "events.organizer_id")
        .select([
            "events.id",
            "events.title",
            "events.description",
            "events.venue",
            "events.starts_at",
            "users.name as organizer_name",
        ])
        .where("events.id", "=", eventId)
        .executeTakeFirst();

    if (!event) throw new AppError("EVENT_NOT_FOUND", "Event not found");

    const ticketTypes = await db
        .selectFrom("ticket_types")
        .select((eb) => [
            "id",
            "name",
            "price",
            "quota",
            "reserved",
            eb("quota", "-", eb.ref("reserved")).as("remaining"),
        ])
        .where("event_id", "=", eventId)
        .orderBy("name")
        .execute();

    return { ...event, ticket_types: ticketTypes };
};

const MAX_TICKETS_PER_BUYER = 4;
const ORDER_TTL_MS = 15 * 60 * 1000;

export const insertOrderedTickets = async (
    eventId: string,
    userId: string,
    input: orderTicketDTO,
) => {
    const requestedTotal = input.orders.reduce((total, order) => total + order.quantity, 0);

    const typeNames = input.orders.map((order) => order.type_name);
    if (new Set(typeNames).size !== typeNames.length) {
        throw new AppError("VALIDATION_ERROR", "Duplicate ticket type in order");
    }

    const eventExists = await db
        .selectFrom("events")
        .select("id")
        .where("id", "=", eventId)
        .executeTakeFirst();

    if (!eventExists) throw new AppError("EVENT_NOT_FOUND", "Event not found");

    return await db.transaction().execute(async (trx) => {
        // Ensure a quota row exists so the FOR UPDATE lock below actually serializes
        // concurrent first-time orders from the same buyer.
        await trx
            .insertInto("buyer_event_quota")
            .values({ event_id: eventId, user_id: userId, ticket_count: 0 })
            .onConflict((oc) => oc.columns(["event_id", "user_id"]).doNothing())
            .execute();

        // Lock this buyer's quota row so concurrent requests cannot both pass the limit check.
        const quota = await trx
            .selectFrom("buyer_event_quota")
            .select("ticket_count")
            .where("event_id", "=", eventId)
            .where("user_id", "=", userId)
            .forUpdate()
            .executeTakeFirstOrThrow();

        const alreadyOrdered = quota.ticket_count;
        if (alreadyOrdered + requestedTotal > MAX_TICKETS_PER_BUYER) {
            throw new AppError(
                "BUYER_LIMIT_EXCEEDED",
                `Buyer can order at most ${MAX_TICKETS_PER_BUYER} tickets per event`,
            );
        }

        // Lock the ticket type rows and map requested type names to their DB rows.
        const ticketTypes = await trx
            .selectFrom("ticket_types")
            .select(["id", "name", "price", "quota", "reserved"])
            .where("event_id", "=", eventId)
            .where("name", "in", typeNames)
            .forUpdate()
            .execute();

        const ticketTypeByName = new Map(ticketTypes.map((ticket) => [ticket.name, ticket]));

        const orderItemValues = input.orders.map((order) => {
            const ticketType = ticketTypeByName.get(order.type_name);
            if (!ticketType) {
                throw new AppError(
                    "TICKET_TYPE_NOT_FOUND",
                    `Ticket type ${order.type_name} not found`,
                );
            }

            const remaining = ticketType.quota - ticketType.reserved;
            if (order.quantity > remaining) {
                throw new AppError(
                    "QUOTA_EXCEEDED",
                    `Not enough remaining quota for ${ticketType.name} ticket`,
                );
            }

            return {
                ticketType,
                quantity: order.quantity,
                unit_price: ticketType.price,
            };
        });

        const totalAmount = orderItemValues.reduce(
            (total, item) => total + item.quantity * item.unit_price,
            0,
        );
        const now = new Date();
        const expiresAt = new Date(now.getTime() + ORDER_TTL_MS);

        const order = await trx
            .insertInto("orders")
            .values({
                user_id: userId,
                event_id: eventId,
                total_amount: totalAmount,
                status: "pending",
                created_at: now,
                expires_at: expiresAt,
            })
            .returningAll()
            .executeTakeFirstOrThrow();

        const orderItems = await trx
            .insertInto("order_items")
            .values(
                orderItemValues.map((item) => ({
                    order_id: order.id,
                    event_id: eventId,
                    ticket_type_id: item.ticketType.id,
                    quantity: item.quantity,
                    unit_price: item.unit_price,
                })),
            )
            .returningAll()
            .execute();

        // Reserve stock per ticket type.
        for (const item of orderItemValues) {
            await trx
                .updateTable("ticket_types")
                .set((eb) => ({ reserved: eb("reserved", "+", item.quantity) }))
                .where("id", "=", item.ticketType.id)
                .execute();
        }

        // Track the buyer's total tickets for this event.
        await trx
            .insertInto("buyer_event_quota")
            .values({
                event_id: eventId,
                user_id: userId,
                ticket_count: requestedTotal,
            })
            .onConflict((oc) =>
                oc.columns(["event_id", "user_id"]).doUpdateSet((eb) => ({
                    ticket_count: eb("buyer_event_quota.ticket_count", "+", requestedTotal),
                })),
            )
            .execute();

        return { ...order, order_items: orderItems };
    });
};

export const insertEvent = async (organizerId: string, input: createEventDTO) => {
    return await db.transaction().execute(async (trx) => {
        const event = await trx
            .insertInto("events")
            .values({
                organizer_id: organizerId,
                title: input.title,
                description: input.description ?? null,
                venue: input.venue,
                starts_at: input.starts_at,
            })
            .returningAll()
            .executeTakeFirstOrThrow();

        const ticketTypes = await trx
            .insertInto("ticket_types")
            .values(
                input.tickets.map((ticket) => ({
                    event_id: event.id,
                    name: ticket.type_name,
                    price: ticket.price,
                    quota: ticket.quota,
                })),
            )
            .returningAll()
            .execute();

        return { ...event, ticket_types: ticketTypes };
    });
};

const findEventRow = async (eventId: string) =>
    await db.selectFrom("events").selectAll().where("id", "=", eventId).executeTakeFirst();

type EventRow = NonNullable<Awaited<ReturnType<typeof findEventRow>>>;

const countSoldByTicketType = async (eventId: string) => {
    const rows = await db
        .selectFrom("order_items")
        .innerJoin("orders", "orders.id", "order_items.order_id")
        .select((eb) => [
            "order_items.ticket_type_id",
            eb.fn.sum("order_items.quantity").as("sold"),
        ])
        .where("order_items.event_id", "=", eventId)
        .where("orders.status", "=", "paid")
        .groupBy("order_items.ticket_type_id")
        .execute();

    return new Map(rows.map((row) => [row.ticket_type_id, Number(row.sold)]));
};

const withTicketTypes = async (event: EventRow) => {
    const [ticketTypes, soldByType] = await Promise.all([
        db
            .selectFrom("ticket_types")
            .select(["id", "name", "price", "quota", "reserved"])
            .where("event_id", "=", event.id)
            .orderBy("name")
            .execute(),
        countSoldByTicketType(event.id),
    ]);

    return {
        ...event,
        ticket_types: ticketTypes.map((ticket) => ({
            ...ticket,
            sold: soldByType.get(ticket.id) ?? 0,
        })),
    };
};

/**
 * Organizer-scoped detail view. Ownership is enforced here so callers cannot
 * accidentally read another organizer's event; a mismatch is reported as
 * EVENT_NOT_FOUND so the event's existence is not leaked.
 */
export const getOrganizerEvent = async (eventId: string, organizerId: string) => {
    const event = await findEventRow(eventId);

    if (!event || event.organizer_id !== organizerId) {
        throw new AppError("EVENT_NOT_FOUND", "Event not found");
    }

    return withTicketTypes(event);
};
