import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

if (!process.env.DATABASE_URL) {
  console.warn('DATABASE_URL is not set. Drizzle config will use an empty connection string.');
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  migrations: {
    table: 'drizzle_migrations',
  },
});
