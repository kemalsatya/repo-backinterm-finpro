import { expireStaleOrders } from "./orders.service";

type OrderExpirySweeperOptions = {
    intervalMs: number;
    batchSize: number;
};

/**
 * Periodically expires pending orders whose 15-minute window has passed and
 * releases their quota. Uses a recursive timeout so runs never overlap, and
 * returns a stop function for graceful shutdown.
 */
export const startOrderExpirySweeper = ({
    intervalMs,
    batchSize,
}: OrderExpirySweeperOptions): (() => void) => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const run = async () => {
        try {
            const expired = await expireStaleOrders(batchSize);

            if (expired > 0) {
                console.log(`[sweeper] expired ${expired} order(s)`);
            }
        } catch (error) {
            console.error("[sweeper] run failed", error);
        } finally {
            if (!stopped) timer = setTimeout(run, intervalMs);
        }
    };

    timer = setTimeout(run, intervalMs);

    return () => {
        stopped = true;

        if (timer) clearTimeout(timer);
    };
};
