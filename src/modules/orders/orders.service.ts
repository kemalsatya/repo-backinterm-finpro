import { randomUUID } from "node:crypto";
import type { Selectable, Transaction } from "kysely";
import { db } from "../../db";
import type { DB, Orders } from "../../db/type";
import { AppError } from "../../utils/app-error";
import type {
    orderDTO,
    orderItemDTO,
    orderItemRowDTO,
    orderRowDTO,
    ticketDTO,
} from "./orders.schema";

const selectBuyerOrders = (userId: string) =>
    db
        .selectFrom("orders")
        .innerJoin("events", "events.id", "orders.event_id")
        .select([
            "orders.id",
            "orders.status",
            "orders.total_amount",
            "orders.expires_at",
            "orders.paid_at",
            "orders.cancelled_at",
            "orders.created_at",
            "events.id as event_id",
            "events.title as event_title",
            "events.venue as event_venue",
            "events.starts_at as event_starts_at",
        ])
        .where("orders.user_id", "=", userId);

const fetchItemsAndTickets = async (orderIds: string[]) => {
    const itemsByOrder = new Map<string, orderItemDTO[]>();

    if (orderIds.length === 0) return itemsByOrder;

    const items: orderItemRowDTO[] = await db
        .selectFrom("order_items")
        .innerJoin("ticket_types", (join) =>
            join
                .onRef("ticket_types.id", "=", "order_items.ticket_type_id")
                .onRef("ticket_types.event_id", "=", "order_items.event_id"),
        )
        .select([
            "order_items.id",
            "order_items.order_id",
            "order_items.ticket_type_id",
            "order_items.quantity",
            "order_items.unit_price",
            "ticket_types.name as ticket_type_name",
        ])
        .where("order_items.order_id", "in", orderIds)
        .orderBy("order_items.id")
        .execute();

    const itemIds = items.map((item) => item.id);
    const tickets: ticketDTO[] =
        itemIds.length === 0
            ? []
            : await db
                  .selectFrom("tickets")
                  .select(["id", "order_item_id", "code", "seq", "issued_at"])
                  .where("order_item_id", "in", itemIds)
                  .orderBy("seq")
                  .execute();

    const ticketsByItem = new Map<string, ticketDTO[]>();
    for (const ticket of tickets) {
        const list = ticketsByItem.get(ticket.order_item_id) ?? [];
        list.push(ticket);
        ticketsByItem.set(ticket.order_item_id, list);
    }

    for (const item of items) {
        const orderItems = itemsByOrder.get(item.order_id) ?? [];
        orderItems.push(
            toOrderItem({
                ...item,
                tickets: ticketsByItem.get(item.id) ?? [],
            }),
        );
        itemsByOrder.set(item.order_id, orderItems);
    }

    return itemsByOrder;
};

const toOrderItem = (item: orderItemRowDTO & { tickets: ticketDTO[] }): orderItemDTO => ({
    id: item.id,
    ticket_type_id: item.ticket_type_id,
    ticket_type_name: item.ticket_type_name,
    quantity: item.quantity,
    unit_price: item.unit_price,
    tickets: item.tickets,
});

const toOrder = (row: orderRowDTO, items: orderItemDTO[]): orderDTO => ({
    id: row.id,
    status: row.status,
    total_amount: row.total_amount,
    expires_at: row.expires_at,
    paid_at: row.paid_at,
    cancelled_at: row.cancelled_at,
    created_at: row.created_at,
    event: {
        id: row.event_id,
        title: row.event_title,
        venue: row.event_venue,
        starts_at: row.event_starts_at,
    },
    items,
});

export const listBuyerOrders = async (userId: string): Promise<orderDTO[]> => {
    const rows: orderRowDTO[] = await selectBuyerOrders(userId)
        .orderBy("orders.created_at", "desc")
        .orderBy("orders.id")
        .execute();

    if (rows.length === 0) return [];

    const itemsByOrder = await fetchItemsAndTickets(rows.map((row) => row.id));

    return rows.map((row) => toOrder(row, itemsByOrder.get(row.id) ?? []));
};

const releaseOrderQuota = async (
    trx: Transaction<DB>,
    order: Pick<Selectable<Orders>, "id" | "event_id" | "user_id">,
) => {
    const items = await trx
        .selectFrom("order_items")
        .select(["ticket_type_id", "quantity"])
        .where("order_id", "=", order.id)
        .execute();

    for (const item of items) {
        await trx
            .updateTable("ticket_types")
            .set((eb) => ({ reserved: eb("reserved", "-", item.quantity) }))
            .where("id", "=", item.ticket_type_id)
            .execute();
    }

    const total = items.reduce((sum, item) => sum + item.quantity, 0);
    await trx
        .updateTable("buyer_event_quota")
        .set((eb) => ({ ticket_count: eb("ticket_count", "-", total) }))
        .where("event_id", "=", order.event_id)
        .where("user_id", "=", order.user_id)
        .execute();
};

const expireOrder = async (
    trx: Transaction<DB>,
    order: Pick<Selectable<Orders>, "id" | "event_id" | "user_id">,
) => {
    await trx.updateTable("orders").set({ status: "expired" }).where("id", "=", order.id).execute();

    await releaseOrderQuota(trx, order);
};

export const expireStaleOrders = async (limit = 100): Promise<number> =>
    await db.transaction().execute(async (trx) => {
        const stale = await trx
            .selectFrom("orders")
            .selectAll()
            .where("status", "=", "pending")
            .where("expires_at", "<=", new Date())
            .orderBy("expires_at")
            .limit(limit)
            .forUpdate()
            .skipLocked()
            .execute();

        for (const order of stale) {
            await expireOrder(trx, order);
        }

        return stale.length;
    });

export const payOrder = async (orderId: string, userId: string): Promise<orderDTO> => {
    const now = new Date();

    const outcome = await db.transaction().execute(async (trx) => {
        const order = await trx
            .selectFrom("orders")
            .selectAll()
            .where("id", "=", orderId)
            .where("user_id", "=", userId)
            .forUpdate()
            .executeTakeFirst();

        if (!order) throw new AppError("ORDER_NOT_FOUND", "Order not found");

        if (order.status !== "pending") {
            throw new AppError("ORDER_NOT_PENDING", "Order is not pending");
        }

        // Lazy expiry: commit the expiry (and quota release) even though the
        // request will be answered with 410.
        if (order.expires_at <= now) {
            await expireOrder(trx, order);

            return "expired" as const;
        }

        await trx
            .updateTable("orders")
            .set({ status: "paid", paid_at: now })
            .where("id", "=", order.id)
            .where("status", "=", "pending")
            .execute();

        const items = await trx
            .selectFrom("order_items")
            .select(["id", "quantity"])
            .where("order_id", "=", order.id)
            .execute();

        const tickets = items.flatMap((item) =>
            Array.from({ length: item.quantity }, (_, index) => ({
                order_item_id: item.id,
                seq: index + 1,
                code: `TKT-${randomUUID()}`,
            })),
        );

        if (tickets.length > 0) {
            await trx.insertInto("tickets").values(tickets).execute();
        }

        return "paid" as const;
    });

    if (outcome === "expired") {
        throw new AppError("ORDER_NOT_PENDING", "Order has expired");
    }

    return getBuyerOrderDetail(orderId, userId);
};

export const getBuyerOrderDetail = async (orderId: string, userId: string): Promise<orderDTO> => {
    const row: orderRowDTO | undefined = await selectBuyerOrders(userId)
        .where("orders.id", "=", orderId)
        .executeTakeFirst();

    if (!row) throw new AppError("ORDER_NOT_FOUND", "Order not found");

    const itemsByOrder = await fetchItemsAndTickets([row.id]);

    return toOrder(row, itemsByOrder.get(row.id) ?? []);
};

export const cancelOrder = async (orderId: string, userId: string): Promise<orderDTO> => {
    const now = new Date();

    const outcome = await db.transaction().execute(async (trx) => {
        const order = await trx
            .selectFrom("orders")
            .selectAll()
            .where("id", "=", orderId)
            .where("user_id", "=", userId)
            .forUpdate()
            .executeTakeFirst();

        if (!order) throw new AppError("ORDER_NOT_FOUND", "Order not found");

        if (order.status !== "pending") {
            throw new AppError("ORDER_NOT_PENDING", "Order is not pending");
        }

        // Lazy expiry: commit the expiry (and quota release) even though the
        // request will be answered with 410.
        if (order.expires_at <= now) {
            await expireOrder(trx, order);

            return "expired" as const;
        }

        await trx
            .updateTable("orders")
            .set({ status: "cancelled", cancelled_at: now })
            .where("id", "=", order.id)
            .where("status", "=", "pending")
            .execute();

        await releaseOrderQuota(trx, order);

        return "cancelled" as const;
    });

    if (outcome === "expired") {
        throw new AppError("ORDER_NOT_PENDING", "Order has expired");
    }

    return getBuyerOrderDetail(orderId, userId);
};
