import type { Kysely } from "kysely";
import type { DB } from "../type";

const ORGANIZER_EMAIL = "organizer@example.com";
const BUYER_EMAIL = "buyer@example.com";

const EVENT_ID = "33333333-3333-4333-8333-333333333333";
const EVENT_TITLE = "Demo Concert";
const EVENT_DESCRIPTION = "Seeded demo event";
const EVENT_VENUE = "Jakarta";
const EVENT_STARTS_AT = new Date("2026-12-31T19:00:00.000Z");

export default {
    async seed(db: Kysely<DB>) {
        const organizer = await db
            .insertInto("users")
            .values({ email: ORGANIZER_EMAIL, name: "Demo Organizer", role: "organizer" })
            .onConflict((oc) =>
                oc.column("email").doUpdateSet({ name: "Demo Organizer", role: "organizer" }),
            )
            .returning("id")
            .executeTakeFirstOrThrow();

        await db
            .insertInto("users")
            .values({ email: BUYER_EMAIL, name: "Demo Buyer", role: "buyer" })
            .onConflict((oc) =>
                oc.column("email").doUpdateSet({ name: "Demo Buyer", role: "buyer" }),
            )
            .execute();

        await db
            .insertInto("events")
            .values({
                id: EVENT_ID,
                organizer_id: organizer.id,
                title: EVENT_TITLE,
                description: EVENT_DESCRIPTION,
                venue: EVENT_VENUE,
                starts_at: EVENT_STARTS_AT,
            })
            .onConflict((oc) =>
                oc.column("id").doUpdateSet({
                    organizer_id: organizer.id,
                    title: EVENT_TITLE,
                    description: EVENT_DESCRIPTION,
                    venue: EVENT_VENUE,
                    starts_at: EVENT_STARTS_AT,
                }),
            )
            .execute();

        await db
            .insertInto("ticket_types")
            .values([
                { event_id: EVENT_ID, name: "REGULER", price: 150_000, quota: 100 },
                { event_id: EVENT_ID, name: "VIP", price: 500_000, quota: 20 },
            ])
            .onConflict((oc) =>
                oc.columns(["event_id", "name"]).doUpdateSet((eb) => ({
                    price: eb.ref("excluded.price"),
                    quota: eb.ref("excluded.quota"),
                })),
            )
            .execute();

        console.log(
            `Seeded ${ORGANIZER_EMAIL} / ${BUYER_EMAIL} and event "${EVENT_TITLE}" (${EVENT_ID})`,
        );
    },
};
