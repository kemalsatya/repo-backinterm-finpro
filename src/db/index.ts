import { sql } from 'kysely'
import { createDb } from './dialect'

export const db = createDb()

export const checkConnectionDB = async () => {
    const response = await sql`select 1`.execute(db)
    if (response) return true
}