import dotenv from 'dotenv';
import { Pool } from 'pg';
import { spawn } from 'node:child_process';

dotenv.config();

const MAX_DB_RETRIES = 30;
const RETRY_DELAY_MS = 1000;

async function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureDatabaseReady(pool: Pool) {
  for (let attempt = 1; attempt <= MAX_DB_RETRIES; attempt++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (error) {
      if (attempt === MAX_DB_RETRIES) {
        throw error;
      }
      console.warn(
        `Database not ready (attempt ${attempt}/${MAX_DB_RETRIES}). Retrying in ${
          RETRY_DELAY_MS / 1000
        }s...`,
      );
      await wait(RETRY_DELAY_MS);
    }
  }
}

function runCommand(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env: process.env,
      shell: false,
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `${command} ${args.join(' ')} exited with code ${code ?? 'unknown'}`,
          ),
        );
      }
    });

    child.on('error', (error) => reject(error));
  });
}

async function tableExists(pool: Pool, tableName: string) {
  const result = await pool.query<{ exists: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = $1
      ) AS exists;
    `,
    [tableName],
  );

  const value = result.rows?.[0]?.exists;
  return value === true || value === 't' || value === 'true';
}

function ensureSafeIdentifier(value: string, label: string) {
  if (!/^[a-zA-Z0-9_]+$/.test(value)) {
    throw new Error(`Unsafe ${label}: ${value}`);
  }
  return value;
}

async function ensureDatabaseExists(
  connectionString: string,
  databaseName: string,
  owner: string,
) {
  const adminUrl = new URL(connectionString);
  adminUrl.pathname = '/postgres';

  const adminPool = new Pool({ connectionString: adminUrl.toString() });
  try {
    const result = await adminPool.query<{ exists: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists;',
      [databaseName],
    );
    const value = result.rows?.[0]?.exists;
    const exists = value === true || value === 't' || value === 'true';
    if (exists) {
      return;
    }

    const safeDb = ensureSafeIdentifier(databaseName, 'database name');
    const safeOwner = ensureSafeIdentifier(owner, 'owner');
    console.info(`🆕 Creating database '${safeDb}' for ${safeOwner}...`);
    await adminPool.query(`CREATE DATABASE ${safeDb} OWNER ${safeOwner};`);
    console.info(`✅ Database '${safeDb}' created`);
  } finally {
    await adminPool.end();
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL is required for db:bootstrap. Is your .env loaded?',
    );
  }

  const shouldSeed =
    process.argv.includes('--seed') || process.argv.includes('--with-seed');
  const parsedUrl = new URL(databaseUrl);
  const dbOwner = decodeURIComponent(parsedUrl.username);
  const dbName = decodeURIComponent(parsedUrl.pathname.replace(/^\//, '')) || 'postgres';

  console.info('🔄 Bootstrapping database...');

  // Ensure the target database exists before trying to connect to it
  await ensureDatabaseExists(databaseUrl, dbName, dbOwner);

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    await ensureDatabaseReady(pool);
    console.info('✅ Database is reachable');

    await pool.query('CREATE EXTENSION IF NOT EXISTS vector;');
    console.info('✅ Ensured pgvector extension exists');
  } finally {
    await pool.end();
  }

  await ensureDatabaseExists(databaseUrl, 'n8n', dbOwner);

  console.info('🛠  Running migrations...');
  await runCommand('npm', ['run', 'db:migrate']);
  console.info('✅ Initial migration command finished');

  let schemaReady = false;
  const schemaCheckPool = new Pool({ connectionString: databaseUrl });
  try {
    schemaReady = await tableExists(schemaCheckPool, 'personas');
    if (!schemaReady) {
      console.warn(
        '⚠️  Expected tables missing after db:migrate; running drizzle-kit push as a fallback.',
      );
      await runCommand('npx', ['drizzle-kit', 'push']);
      schemaReady = await tableExists(schemaCheckPool, 'personas');
      if (!schemaReady) {
        throw new Error(
          'Schema verification failed: personas table still missing after drizzle-kit push.',
        );
      }
    }
  } finally {
    await schemaCheckPool.end();
  }

  console.info('✅ Schema is up to date');

  if (shouldSeed) {
    let runSeed = true;
    const seedCheckPool = new Pool({ connectionString: databaseUrl });
    try {
      const result = await seedCheckPool.query<{
        count: string;
      }>('SELECT COUNT(*)::text as count FROM personas;');
      const existingPersonas = Number(result.rows?.[0]?.count ?? '0');
      if (existingPersonas > 0) {
        runSeed = false;
        console.info(
          `ℹ️  Seed skipped: personas table already has ${existingPersonas} rows`,
        );
      }
    } catch (error) {
      console.warn(
        '⚠️  Could not inspect personas table; proceeding with seed.',
        error,
      );
    } finally {
      await seedCheckPool.end();
    }

    if (runSeed) {
      console.info('🌱 Seeding development data...');
      await runCommand('npm', ['run', 'db:seed']);
      console.info('✅ Seed data ready');
    }
  }

  console.info('🎉 Database bootstrap finished');
}

main().catch((error) => {
  console.error('❌ Database bootstrap failed:', error);
  process.exit(1);
});
