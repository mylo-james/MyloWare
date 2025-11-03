import 'dotenv/config';
import path from 'node:path';
import { runOperationsMigrations } from '../src/db/operations/migrations';

async function main(): Promise<void> {
  const migrationsFolder = path.resolve(__dirname, '../drizzle-operations');
  console.log(`Running operations migrations from ${migrationsFolder}`);
  await runOperationsMigrations();
  console.log('Operations migrations completed successfully.');
}

main().catch((error) => {
  console.error('Operations migration failed:', error);
  process.exitCode = 1;
});
