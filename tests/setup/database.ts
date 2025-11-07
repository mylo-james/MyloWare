import { afterAll } from 'vitest';
import { GenericContainer } from 'testcontainers';
import pg from 'pg';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'path';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const REQUESTED_POSTGRES_PORT =
  process.env.TEST_DB_PORT && !Number.isNaN(Number(process.env.TEST_DB_PORT))
    ? Number(process.env.TEST_DB_PORT)
    : undefined;
const projectRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

type CleanupFn = () => Promise<void>;

const { databaseUrl, cleanup } = await initializeDatabase();

process.env.DATABASE_URL = databaseUrl;
process.env.OPERATIONS_DATABASE_URL = databaseUrl;

const { resetDbClient } = await import('@/db/client.js');
await resetDbClient(databaseUrl);

const { seedBaseData } = await import('./seed.ts');

await waitForDatabase(databaseUrl);
await ensureVectorExtension(databaseUrl);
await runDrizzlePush(databaseUrl);
await seedBaseData();

afterAll(async () => {
  await cleanup();
});

async function waitForDatabase(url: string, retries = 10) {
  const client = new pg.Client({ connectionString: url });
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      await client.connect();
      await client.end();
      return;
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error('Unable to connect to Postgres test container');
}

async function ensureVectorExtension(url: string) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query('CREATE EXTENSION IF NOT EXISTS vector');
  await client.end();
}

async function runDrizzlePush(url: string) {
  const { stdout, stderr } = await execFileAsync('npx', ['drizzle-kit', 'push'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      DATABASE_URL: url,
    },
  });
  if (process.env.LOG_LEVEL === 'debug') {
    if (stdout) {
      console.info('[drizzle-push]', stdout.trim());
    }
    if (stderr) {
      console.warn('[drizzle-push:stderr]', stderr.trim());
    }
  }
}

async function initializeDatabase(): Promise<{ databaseUrl: string; cleanup: CleanupFn }> {
  const useContainer = process.env.TEST_DB_USE_CONTAINER === '1';
  if (!useContainer) {
    const databaseUrl = process.env.TEST_DB_URL || process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error(
        'Set TEST_DB_URL (preferred) or run with TEST_DB_USE_CONTAINER=1 to start a disposable Postgres container.'
      );
    }

    return {
      databaseUrl,
      cleanup: async () => {
        const { pool } = await import('@/db/client.js');
        await pool.end();
      },
    };
  }

  let containerBuilder = new GenericContainer('pgvector/pgvector:pg16')
    .withEnvironment({
      POSTGRES_PASSWORD: 'test',
      POSTGRES_USER: 'test',
      POSTGRES_DB: 'mcp_v2_test',
    });

  if (REQUESTED_POSTGRES_PORT) {
    containerBuilder = containerBuilder.withExposedPorts({
      container: 5432,
      host: REQUESTED_POSTGRES_PORT,
    });
  } else {
    containerBuilder = containerBuilder.withExposedPorts(5432);
  }

  const container = await containerBuilder.start();
  const mappedPort = REQUESTED_POSTGRES_PORT ?? container.getMappedPort(5432);
  process.env.POSTGRES_PORT = String(mappedPort);
  const databaseUrl = `postgresql://test:test@127.0.0.1:${mappedPort}/mcp_v2_test`;

  return {
    databaseUrl,
    cleanup: async () => {
      const { pool } = await import('@/db/client.js');
      await pool.end();
      await container.stop();
    },
  };
}
