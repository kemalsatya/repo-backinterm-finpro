import z from "zod";
import { detailedTicketOrderSchema } from "../events/events.contract";

export const orderTicketSchema = z.object({
    orders: z.array(detailedTicketOrderSchema),
});

export type orderTicketDTO = z.infer<typeof orderTicketSchema>;
