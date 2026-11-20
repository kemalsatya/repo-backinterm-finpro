import { db } from "../../db";
import { AppError } from "../../utils/app-error";

export const findUser = async (email: string, role: string) => {
    const user = await db
        .selectFrom("users")
        .select(["id"])
        .where("email", "=", email)
        .where("role", "=", role)
        .executeTakeFirst();

    if (!user) throw new AppError("USER_NOT_FOUND", "User not found");
    return user;
};
