import { defineConfig } from "kysely-ctl";
import { createDb } from "./src/db/dialect";

export default defineConfig({
    kysely: createDb(),
    seeds: { seedFolder: "src/db/seeds" },
});
