import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import router from "./router";
import { AppError } from "./utils/app-error";

const app = new Hono();

app.route("/api/", router);

app.onError((err, c) => {
    if (err instanceof AppError) {
        return c.json({ error: { code: err.code, message: err.message } }, err.status);
    }

    if (err instanceof HTTPException) {
        return c.json(
            {
                error: {
                    code: err.status === 401 ? "UNAUTHORIZED" : "INTERNAL_ERROR",
                    message: err.message,
                },
            },
            err.status,
        );
    }

    console.error(err);
    return c.json(
        {
            error: {
                code: "INTERNAL_ERROR",
                message: "Something went wrong",
            },
        },
        500,
    );
});

export default app;
