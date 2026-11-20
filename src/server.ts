import { ENV } from "./config/env";
import { checkConnectionDB } from "./db";
import app from "./app";

await checkConnectionDB()

console.log(`[LOG] Server is running at port ${ENV.port}`);

Bun.serve({
    fetch: app.fetch,
    port: ENV.port
});
