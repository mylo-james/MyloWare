import 'dotenv/config';
import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from '../src/db/client';
import { createPool, closePool } from '../src/db/pool';

async function main(): Promise<void> {
  const pool = createPool();
  const db = createDb(pool);
  const migrationsFolder = path.resolve(__dirname, '../drizzle');

  console.log(`Running migrations from ${migrationsFolder}`);
  await migrate(db, { migrationsFolder });
  console.log('Migrations completed successfully.');

  await closePool();
}

main().catch((error) => {
  console.error('Migration failed:', error);
  process.exitCode = 1;
});
