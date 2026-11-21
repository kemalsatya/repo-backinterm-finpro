import z from "zod";

export const ticketTypeSchema = z.object({
    type_name: z.enum(["REGULER", "VIP"]),
    price: z.number().int().min(0),
    quota: z.number().int().min(1),
});

export const createEventSchema = z.object({
    title: z.string().min(1),
    description: z.string().optional(),
    venue: z.string().min(1),
    starts_at: z.coerce.date(),
    tickets: z
        .array(ticketTypeSchema)
        .length(2)
        .refine((tickets) => new Set(tickets.map((ticket) => ticket.type_name)).size === 2, {
            message: "must contain exactly one REGULER and one VIP ticket type",
        }),
});

export const detailedTicketOrderSchema = z.object({
    type_name: z.enum(["REGULER", "VIP"]),
    quantity: z.number().int().min(1),
});

export type TicketTypeDTO = z.infer<typeof ticketTypeSchema>;
export type createEventDTO = z.infer<typeof createEventSchema>;
//export type ticketOrderDTO = z.infer<typeof detailedTicketOrderSchema>
