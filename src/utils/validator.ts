import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import type { z } from "zod";

/**
 * zValidator with the API's standard error envelope.
 * Usage: validator("json", loginSchema)
 */
export const validator = <T extends z.ZodType, Target extends keyof ValidationTargets>(
    target: Target,
    schema: T,
) =>
    zValidator(target, schema, (result, c) => {
        if (result.success) return;

        const issue = result.error.issues[0];
        const field = issue?.path.join(".");
        const message = !issue
            ? "Invalid request"
            : field
              ? `${field}: ${issue.message}`
              : issue.message;

        return c.json(
            {
                error: {
                    code: "VALIDATION_ERROR",
                    message: message,
                },
            },
            400,
        );
    });
