import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

if (!process.env.OPERATIONS_DATABASE_URL) {
  console.warn(
    'OPERATIONS_DATABASE_URL is not set. Operations Drizzle config will use an empty connection string.',
  );
}

export default defineConfig({
  schema: './src/db/operations/schema.ts',
  out: './drizzle-operations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.OPERATIONS_DATABASE_URL ?? '',
  },
  migrations: {
    table: 'drizzle_operations_migrations',
  },
});
