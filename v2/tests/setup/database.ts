import { afterAll } from 'vitest';
import { GenericContainer } from 'testcontainers';
import pg from 'pg';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'path';
import { fileURLToPath } from 'url';
import { seedBaseData } from './seed.ts';

const execFileAsync = promisify(execFile);
const POSTGRES_PORT = Number(process.env.TEST_DB_PORT || 6543);
const projectRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

const container = await new GenericContainer('pgvector/pgvector:pg16')
  .withEnvironment({
    POSTGRES_PASSWORD: 'test',
    POSTGRES_USER: 'test',
    POSTGRES_DB: 'mcp_v2_test',
  })
  .withExposedPorts(5432)
  .withFixedExposedPort(POSTGRES_PORT, 5432)
  .start();

const databaseUrl = `postgresql://test:test@127.0.0.1:${POSTGRES_PORT}/mcp_v2_test`;
process.env.DATABASE_URL = databaseUrl;
process.env.OPERATIONS_DATABASE_URL = databaseUrl;

await waitForDatabase(databaseUrl);
await ensureVectorExtension(databaseUrl);
await runDrizzlePush();
await seedBaseData();

afterAll(async () => {
  const { pool } = await import('@/db/client.js');
  await pool.end();
  await container.stop();
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

async function runDrizzlePush() {
  await execFileAsync('npx', ['drizzle-kit', 'push'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
    },
  });
}
