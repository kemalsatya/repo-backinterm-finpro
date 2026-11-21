import { sql } from "kysely";
import { Pool } from "pg";
import { db } from "../../src/db";

const TEST_DATABASE_URL = Bun.env.TEST_DATABASE_URL;

export const hasTestDb = Boolean(TEST_DATABASE_URL);

const schemaFile = new URL("../../src/db/schema.sql", import.meta.url);

let pool: Pool | undefined;

const getPool = (): Pool => {
    if (!TEST_DATABASE_URL) {
        throw new Error("TEST_DATABASE_URL is not set");
    }

    pool ??= new Pool({ connectionString: TEST_DATABASE_URL });

    return pool;
};

const currentDatabase = async (nameResult: { rows: { name?: string }[] }) =>
    nameResult.rows[0]?.name ?? "";

export const bootstrapTestDb = async () => {
    const testPool = getPool();

    const poolDbName = await currentDatabase(
        await testPool.query<{ name: string }>("select current_database() as name"),
    );

    // Safety: the app and this pool must both point at the same *test* database.
    const appDbName = await currentDatabase(
        await sql<{ name: string }>`select current_database() as name`.execute(db),
    );

    if (!/test/i.test(poolDbName) || !/test/i.test(appDbName)) {
        throw new Error(
            `Refusing to run DB tests against non-test databases (pool="${poolDbName}", app="${appDbName}")`,
        );
    }

    if (poolDbName !== appDbName) {
        throw new Error(
            `App DB ("${appDbName}") and TEST_DATABASE_URL DB ("${poolDbName}") differ; ` +
                "the test preload likely failed to set DATABASE_URL",
        );
    }

    const schema = await Bun.file(schemaFile).text();

    await testPool.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
    await testPool.query(schema);
};

export const truncateAll = async () => {
    await getPool().query(
        "TRUNCATE TABLE tickets, order_items, orders, buyer_event_quota, ticket_types, payment_events, events, users RESTART IDENTITY CASCADE",
    );
};

export const teardownTestDb = async () => {
    if (pool) {
        await pool.end();
        pool = undefined;
    }

    await db.destroy();
};

export { db };
