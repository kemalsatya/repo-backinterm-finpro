import { db } from "../../db";
import { AppError } from "../../utils/app-error";
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
