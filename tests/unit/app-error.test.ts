import { describe, expect, test } from "bun:test";
import { AppError, ERROR_STATUS } from "../../src/utils/app-error";

describe("AppError", () => {
    test("maps every error code to its HTTP status", () => {
        for (const code of Object.keys(ERROR_STATUS) as (keyof typeof ERROR_STATUS)[]) {
            const error = new AppError(code, "message");

            expect(error.name).toBe("AppError");
            expect(error.code).toBe(code);
            expect(error.status).toBe(ERROR_STATUS[code]);
            expect(error.message).toBe("message");
        }
    });

    test("is an Error instance", () => {
        expect(new AppError("ORDER_NOT_FOUND", "missing")).toBeInstanceOf(Error);
    });
});
