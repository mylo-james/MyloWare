import { Client } from 'pg';

export class DatabaseCreationPermissionError extends Error {
  constructor(databaseName: string) {
    super(
      `Unable to create database "${databaseName}" (permission denied). ` +
        'Create it manually or grant CREATEDB to the database user.',
    );
    this.name = 'DatabaseCreationPermissionError';
  }
}

function escapeIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export async function ensureDatabaseExists(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to ensure database exists.');
  }

  const url = new URL(connectionString);
  const databaseName = url.pathname.replace(/^\//, '');

  if (!databaseName) {
    throw new Error('DATABASE_URL must include a database name.');
  }

  // First, try connecting directly to the target database. If it exists, we're done.
  const targetClient = new Client({ connectionString });
  try {
    await targetClient.connect();
    return;
  } catch (error) {
    if ((error as { code?: string }).code !== '3D000') {
      throw error;
    }
    // Database is missing; continue with creation attempt.
  } finally {
    await targetClient.end().catch(() => {});
  }

  const adminUrl = new URL(connectionString);
  adminUrl.pathname = '/postgres';

  const client = new Client({
    connectionString: adminUrl.toString(),
  });

  await client.connect();

  try {
    const result = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [databaseName]);
    if (result.rowCount === 0) {
      try {
        await client.query(`CREATE DATABASE ${escapeIdentifier(databaseName)}`);
        console.info(`Created database ${databaseName}`);
      } catch (error) {
        if ((error as { code?: string }).code === '42501') {
          throw new DatabaseCreationPermissionError(databaseName);
        }
        throw error;
      }
    }
  } finally {
    await client.end().catch(() => {});
  }
}
