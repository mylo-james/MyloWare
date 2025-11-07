import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { config } from '../config/index.js';

const { Pool } = pg;

const resolveConnectionString = () => {
  if (!config.database.url) {
    throw new Error('DATABASE_URL is not configured.');
  }

  return config.database.url;
};

export let pool = new Pool({
  connectionString: resolveConnectionString(),
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 2000, // Return an error after 2 seconds if connection cannot be established
});

export let db = drizzle(pool);

export async function resetDbClient(connectionString?: string): Promise<void> {
  await pool.end();
  pool = new Pool({
    connectionString: connectionString || resolveConnectionString(),
    max: 20, // Maximum number of clients in the pool
    idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
    connectionTimeoutMillis: 2000, // Return an error after 2 seconds if connection cannot be established
  });
  db = drizzle(pool);
}
