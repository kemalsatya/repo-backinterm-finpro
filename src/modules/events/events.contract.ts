/**
 * Public surface of the events module.
 *
 * Other modules must import from this file only — never from events.service or
 * events.schema directly — so the internals can change without breaking them.
 */
export type { createEventDTO, TicketTypeDTO } from "./events.schema";
export { createEventSchema } from "./events.schema";
export { getOrganizerEvent, getPublicDetailedEvent, insertEvent } from "./events.service";
