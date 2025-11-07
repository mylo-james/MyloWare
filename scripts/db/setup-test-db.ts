#!/usr/bin/env tsx
import pg from 'pg';

const { Client } = pg;

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

async function main() {
  const targetUrl = process.env.TEST_DB_URL;
  if (!targetUrl) {
    throw new Error('TEST_DB_URL must be set (e.g. postgresql://user:pass@localhost:6543/mcp_v2_test)');
  }

  const superUrl = process.env.TEST_DB_SUPER_URL;
  if (!superUrl) {
    throw new Error('TEST_DB_SUPER_URL must point to a superuser connection string (e.g. postgresql://postgres:password@localhost:6543/postgres)');
  }

  const target = new URL(targetUrl);
  const databaseName = target.pathname.replace(/^\//, '');
  const username = decodeURIComponent(target.username);
  const password = decodeURIComponent(target.password);

  if (!databaseName || !username || !password) {
    throw new Error('TEST_DB_URL must include username, password, and database name');
  }

  const adminClient = new Client({ connectionString: superUrl });
  await adminClient.connect();

  try {
    const roleResult = await adminClient.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [username]);
    if (roleResult.rowCount === 0) {
      await adminClient.query(
        `CREATE ROLE ${quoteIdentifier(username)} LOGIN PASSWORD $1`,
        [password]
      );
      console.log(`👤 Created role ${username}`);
    } else {
      await adminClient.query(
        `ALTER ROLE ${quoteIdentifier(username)} WITH LOGIN PASSWORD $1`,
        [password]
      );
      console.log(`👤 Updated password for role ${username}`);
    }

    const dbResult = await adminClient.query('SELECT 1 FROM pg_database WHERE datname = $1', [databaseName]);
    if (dbResult.rowCount === 0) {
      await adminClient.query(
        `CREATE DATABASE ${quoteIdentifier(databaseName)} OWNER ${quoteIdentifier(username)}`
      );
      console.log(`🆕 Created database ${databaseName}`);
    } else {
      await adminClient.query(
        `ALTER DATABASE ${quoteIdentifier(databaseName)} OWNER TO ${quoteIdentifier(username)}`
      );
      console.log(`🔁 Ensured database ${databaseName} owner is ${username}`);
    }
  } finally {
    await adminClient.end();
  }

  const superDbUrl = new URL(superUrl);
  superDbUrl.pathname = `/${databaseName}`;
  const dbClient = new Client({ connectionString: superDbUrl.toString() });
  await dbClient.connect();

  try {
    await dbClient.query('CREATE EXTENSION IF NOT EXISTS vector');
    await dbClient.query(
      `GRANT ALL PRIVILEGES ON DATABASE ${quoteIdentifier(databaseName)} TO ${quoteIdentifier(username)}`
    );
    console.log('✅ Test database ready for Vitest (vector extension installed)');
  } finally {
    await dbClient.end();
  }
}

main().catch((error) => {
  console.error('❌ Failed to provision test database:', error instanceof Error ? error.message : error);
  process.exit(1);
});
