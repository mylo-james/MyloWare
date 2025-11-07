#!/usr/bin/env tsx
import { exec } from 'child_process';
import { promisify } from 'util';
import { seedAgentWebhooks } from './seed-data/agent-webhooks.js';
import { config } from '../../src/config/index.js';
import pg from 'pg';

const execAsync = promisify(exec);
const { Client } = pg;

function isLocalHost(hostname: string) {
  return ['localhost', '127.0.0.1'].includes(hostname);
}

function quoteIdent(ident: string): string {
  return ident.replace(/"/g, '""');
}

function quoteLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

async function ensureDatabaseAvailable() {
  if (process.env.DOCKER_CONTAINER === 'true') {
    // Already running inside the dev container; nothing to bootstrap.
    return;
  }

  try {
    const dbUrl = new URL(config.database.url);
    if (isLocalHost(dbUrl.hostname)) {
      console.log('🛠️ Ensuring local postgres container is running (docker compose up -d postgres)...');
      await execAsync('docker compose up -d postgres');
    }
  } catch (error) {
    console.warn(
      '⚠️ Unable to verify local database host; proceeding without docker bootstrap.',
      error instanceof Error ? error.message : error
    );
  }
}

async function waitForDatabase(retries = 10, delayMs = 1000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const client = new Client({ connectionString: config.database.url });
      await client.connect();
      await client.end();
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`   … Postgres not ready yet (attempt ${attempt}/${retries}): ${message}`);
      if (attempt === retries) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function provisionLocalRoleAndDatabase() {
  const dbUrl = new URL(config.database.url);
  if (!isLocalHost(dbUrl.hostname)) {
    return;
  }

  const targetUser = decodeURIComponent(dbUrl.username);
  const targetDb = decodeURIComponent(dbUrl.pathname.replace(/^\//, '') || targetUser);
  const targetPassword = decodeURIComponent(dbUrl.password || '');

  const adminUrl = new URL(dbUrl.toString());
  adminUrl.username = process.env.POSTGRES_SUPERUSER || 'postgres';
  adminUrl.password = process.env.DB_PASSWORD || adminUrl.password || '';
  adminUrl.pathname = '/postgres';

  console.log(`🛠️ Creating role/database if missing (user=${targetUser}, db=${targetDb})...`);

  try {
    const client = new Client({ connectionString: adminUrl.toString() });
    await client.connect();

    const roleExists = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [targetUser]);
    if (roleExists.rowCount === 0) {
      const passwordClause = targetPassword
        ? ` PASSWORD '${quoteLiteral(targetPassword)}'`
        : '';
      await client.query(
        `CREATE ROLE "${quoteIdent(targetUser)}" WITH LOGIN${passwordClause}`
      );
      console.log(`   ✓ Created role ${targetUser}`);
    }

    const dbExists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [targetDb]);
    if (dbExists.rowCount === 0) {
      await client.query(
        `CREATE DATABASE "${quoteIdent(targetDb)}" OWNER "${quoteIdent(targetUser)}"`
      );
      console.log(`   ✓ Created database ${targetDb}`);
    }

    await client.end();
  } catch (error) {
    console.warn(
      '⚠️ Unable to auto-provision local role/database; continuing. If failures persist, ensure the role/database exist manually.',
      error instanceof Error ? error.message : error
    );
  }
}

function isRoleMissing(error: unknown) {
  return error instanceof Error && /role ".+" does not exist/i.test(error.message);
}

async function seed() {
  console.log('🌱 Seeding development data...');
  console.log('   (Running migrations to populate personas, projects, and workflows)');

  try {
    await ensureDatabaseAvailable();
    try {
      await waitForDatabase();
    } catch (error) {
      if (isRoleMissing(error)) {
        await provisionLocalRoleAndDatabase();
        await waitForDatabase();
      } else {
        throw error;
      }
    }

    // Run persona migration
    await execAsync('npm run migrate:personas');

    // Run project migration
    await execAsync('npm run migrate:projects');

    // Run workflow migration
    await execAsync('npm run migrate:workflows');

    // Seed agent webhooks
    await seedAgentWebhooks();

    console.log('✅ Development data seeded');
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  }
}

seed();
