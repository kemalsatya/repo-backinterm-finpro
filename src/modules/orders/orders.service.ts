import { db } from "../../db";
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

export const getBuyerOrderDetail = async (orderId: string, userId: string): Promise<orderDTO> => {
    const row: orderRowDTO | undefined = await selectBuyerOrders(userId)
        .where("orders.id", "=", orderId)
        .executeTakeFirst();

    if (!row) throw new AppError("ORDER_NOT_FOUND", "Order not found");

    const itemsByOrder = await fetchItemsAndTickets([row.id]);

    return toOrder(row, itemsByOrder.get(row.id) ?? []);
};
