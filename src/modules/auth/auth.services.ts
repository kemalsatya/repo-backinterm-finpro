import { db } from "../../db"

export const findUser = async (email: string, role: string ) => {
    const user = await db
    .selectFrom('users')
    .select(['id'])
    .where('email', "=", "email")
    .where('role', '=', 'role')
    .executeTakeFirst()

    if (user) return user
    else throw new Error('USER_NOT_FOUND')
}