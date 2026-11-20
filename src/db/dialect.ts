import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { ENV } from "../config/env";
import type { DB } from "./type";

export function createDb() {
    return new Kysely<DB>({
        dialect: new PostgresDialect({
            pool: new Pool({ connectionString: ENV.dbUrl }),
        }),
    });
}
