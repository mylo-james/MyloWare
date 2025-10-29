import 'dotenv/config';
import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createOperationsDb } from '../src/db/operations/client';
import { createOperationsPool, closeOperationsPool } from '../src/db/operations/pool';

async function main(): Promise<void> {
  const pool = createOperationsPool();
  const db = createOperationsDb(pool);
  const migrationsFolder = path.resolve(__dirname, '../drizzle-operations');

  console.log(`Running operations migrations from ${migrationsFolder}`);
  await migrate(db, { migrationsFolder });
  console.log('Operations migrations completed successfully.');

  await closeOperationsPool();
}

main().catch((error) => {
  console.error('Operations migration failed:', error);
  process.exitCode = 1;
});
