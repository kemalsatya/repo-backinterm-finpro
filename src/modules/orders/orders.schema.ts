import z from "zod";
import { detailedTicketOrderSchema } from "../events/events.contract";

export const orderTicketSchema = z.object({
    orders: z.array(detailedTicketOrderSchema),
});

export const ticketSchema = z.object({
    id: z.string(),
    order_item_id: z.string(),
    code: z.string(),
    seq: z.number().int(),
    issued_at: z.date(),
});

export const orderItemSchema = z.object({
    id: z.string(),
    ticket_type_id: z.string(),
    ticket_type_name: z.string(),
    quantity: z.number().int(),
    unit_price: z.number().int(),
    tickets: z.array(ticketSchema),
});

export const orderEventSchema = z.object({
    id: z.string(),
    title: z.string(),
    venue: z.string(),
    starts_at: z.date(),
});

export const orderSchema = z.object({
    id: z.string(),
    status: z.string(),
    total_amount: z.number().int(),
    expires_at: z.date(),
    paid_at: z.date().nullable(),
    cancelled_at: z.date().nullable(),
    created_at: z.date(),
    event: orderEventSchema,
    items: z.array(orderItemSchema),
});

export const orderRowSchema = z.object({
    id: z.string(),
    status: z.string(),
    total_amount: z.number().int(),
    expires_at: z.date(),
    paid_at: z.date().nullable(),
    cancelled_at: z.date().nullable(),
    created_at: z.date(),
    event_id: z.string(),
    event_title: z.string(),
    event_venue: z.string(),
    event_starts_at: z.date(),
});

export const orderItemRowSchema = z.object({
    id: z.string(),
    order_id: z.string(),
    ticket_type_id: z.string(),
    ticket_type_name: z.string(),
    quantity: z.number().int(),
    unit_price: z.number().int(),
});

export type orderTicketDTO = z.infer<typeof orderTicketSchema>;
export type ticketDTO = z.infer<typeof ticketSchema>;
export type orderItemDTO = z.infer<typeof orderItemSchema>;
export type orderEventDTO = z.infer<typeof orderEventSchema>;
export type orderDTO = z.infer<typeof orderSchema>;
export type orderRowDTO = z.infer<typeof orderRowSchema>;
export type orderItemRowDTO = z.infer<typeof orderItemRowSchema>;
