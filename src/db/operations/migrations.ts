import path from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import * as schema from './schema';

/**
 * Run all pending operations database migrations.
 *
 * This creates a temporary pool that is immediately torn down after the
 * migrator finishes so that the main application pool can be initialised
 * normally during server start-up.
 */
export async function runOperationsMigrations(connectionString?: string): Promise<void> {
  const resolvedConnectionString =
    connectionString ?? process.env.OPERATIONS_DATABASE_URL ?? '';

  if (!resolvedConnectionString || resolvedConnectionString.trim().length === 0) {
    throw new Error('OPERATIONS_DATABASE_URL is not configured.');
  }

  const pool = new Pool({ connectionString: resolvedConnectionString });

  try {
    const db = drizzle(pool, { schema });
    const migrationsFolder = path.resolve(process.cwd(), 'drizzle-operations');
    await migrate(db, { migrationsFolder });
  } finally {
    await pool.end();
  }
}
