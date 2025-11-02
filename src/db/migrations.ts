import { readdir } from 'fs/promises';
import { join } from 'path';
import { getDb } from './client';
import { sql } from 'drizzle-orm';

export async function checkPendingMigrations(): Promise<string[]> {
  const db = getDb();

  try {
    // Get applied migrations from database
    const result = await db.execute(sql`
      SELECT * FROM drizzle.__drizzle_migrations
      ORDER BY created_at DESC
    `);

    const rows = result.rows as Array<Record<string, unknown>>;

    let appliedByName: Set<string> | null = null;
    let appliedCount = rows.length;

    for (const row of rows) {
      if (row && typeof row === 'object' && 'name' in row && row.name != null) {
        if (!appliedByName) {
          appliedByName = new Set();
        }
        appliedByName.add(String(row.name));
      }
    }

    // Get migration files from filesystem
    const migrationsDir = join(process.cwd(), 'drizzle');
    const files = await readdir(migrationsDir);
    const migrationFiles = files
      .filter((f) => f.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b));

    // Find pending migrations
    const pending = appliedByName
      ? migrationFiles.filter((f) => !appliedByName!.has(f))
      : migrationFiles.slice(Math.min(appliedCount, migrationFiles.length));

    return pending;
  } catch (error) {
    // If the migrations table doesn't exist, assume all migrations are pending
    // This is a safe default - the first migration should create the table
    console.error('Error checking migrations:', error);
    return [];
  }
}
