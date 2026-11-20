import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ErrorCode } from "./app-error";

export const successResponse = (
    c: Context,
    data: object,
    message: string = "Success",
    statusCode: ContentfulStatusCode = 200,
) => {
    return c.json(
        {
            success: true,
            message: message,
            data: data,
        },
        statusCode,
    );
};

export const errorResponse = (
    c: Context,
    code: ErrorCode,
    message: string,
    statusCode: ContentfulStatusCode,
) => {
    return c.json(
        {
            error: {
                code: code,
                message: message,
            },
        },
        statusCode,
    );
};
