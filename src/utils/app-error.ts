import type { ContentfulStatusCode } from "hono/utils/http-status";

export const ERROR_STATUS = {
    INTERNAL_ERROR: 500,
    UNAUTHORIZED: 401,
    VALIDATION_ERROR: 400,
    USER_NOT_FOUND: 404,
    EVENT_NOT_FOUND: 404,
    TICKET_TYPE_NOT_FOUND: 404,
    ORDER_NOT_FOUND: 404,
    QUOTA_EXCEEDED: 409,
    BUYER_LIMIT_EXCEEDED: 409,
    ORDER_NOT_PENDING: 410,
    INVALID_QUANTITY: 400,
} as const satisfies Record<string, ContentfulStatusCode>;

export type ErrorCode = keyof typeof ERROR_STATUS;

export class AppError extends Error {
    readonly code: ErrorCode;
    readonly status: ContentfulStatusCode;

    constructor(code: ErrorCode, message: string) {
        super(message);
        this.name = "AppError";
        this.code = code;
        this.status = ERROR_STATUS[code];
    }
}
