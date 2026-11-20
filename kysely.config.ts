import { defineConfig } from "kysely-ctl";
import { createDb } from "./src/db/dialect";

export default defineConfig({
    kysely: createDb(),
    migrations: { migrationFolder: "src/db/migrations" },
    seeds: { seedFolder: "src/db/seeds" },
});
