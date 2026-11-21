import app from "./app";
import { ENV } from "./config/env";
import { checkConnectionDB } from "./db";
import { startOrderExpirySweeper } from "./modules/orders/orders.contract";

if (await checkConnectionDB()) {
    console.log(`[LOG] Database is ready`);
}

if (ENV.order_sweeper.enabled) {
    const stopSweeper = startOrderExpirySweeper({
        intervalMs: ENV.order_sweeper.interval_ms,
        batchSize: ENV.order_sweeper.batch_size,
    });

    console.log("[LOG] Order expiry sweeper started");

    process.once("SIGINT", stopSweeper);
    process.once("SIGTERM", stopSweeper);
}

console.log(`[LOG] Server is running at port ${ENV.port}`);

Bun.serve({
    fetch: app.fetch,
    port: ENV.port,
});
