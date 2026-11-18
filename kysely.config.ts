import { Pool } from 'pg'
import { defineConfig } from 'kysely-ctl'
import { Kysely, PostgresDialect } from 'kysely'
import type { DB } from './src/db/type'

const dialect = new PostgresDialect({
  pool: new Pool({ connectionString: process.env.DATABASE_URL })
})
const migrations = {
  migrationFolder: 'src/db/migrations',
}
const seeds = {
  seedFolder: 'src/db/seeds',
}

// const db = new Kysely<DB>({ dialect })
export default defineConfig({ dialect, migrations, seeds })