import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { config } from '../config/index.js';

const { Pool } = pg;

const resolveConnectionString = () => process.env.DATABASE_URL || config.database.url;

export let pool = new Pool({
  connectionString: resolveConnectionString(),
});

export let db = drizzle(pool);

export async function resetDbClient(connectionString?: string): Promise<void> {
  await pool.end();
  pool = new Pool({
    connectionString: connectionString || resolveConnectionString(),
  });
  db = drizzle(pool);
}
