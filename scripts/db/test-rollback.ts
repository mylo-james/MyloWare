#!/usr/bin/env tsx
import { GenericContainer } from 'testcontainers';
import { Pool } from 'pg';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(__filename), '../..');

async function main() {
  log('Starting rollback smoke test (ephemeral Postgres)...');
  const startupTimeoutMs = Number(process.env.ROLLBACK_STARTUP_TIMEOUT_MS ?? 120_000);

  configureDockerSocket();
  const originalPostgresPort = process.env.POSTGRES_PORT;

  let container: Awaited<ReturnType<GenericContainer['start']>> | null = null;
  try {
    log('Pulling pgvector container and waiting for Docker...');
    container = await new GenericContainer('pgvector/pgvector:pg16')
      .withEnvironment({
        POSTGRES_PASSWORD: 'test',
        POSTGRES_USER: 'test',
        POSTGRES_DB: 'mcp_rollback_test',
      })
      .withExposedPorts(5432)
      .withStartupTimeout(startupTimeoutMs)
      .start();
    const port = container.getMappedPort(5432);
    const host = container.getHost();
    log(`Container ready (host=${host}, port=${port})`);

    const databaseUrl = `postgresql://test:test@${host}:${port}/mcp_rollback_test`;
    await waitForDatabase(databaseUrl);
    await ensureVectorExtension(databaseUrl);

    await runMigrations(databaseUrl, 'Initial apply');
    await assertTableExists(databaseUrl, 'execution_traces');

  await dropSchema(databaseUrl);
  log('Schema dropped (simulated rollback). Reapplying migrations...');
  await ensureVectorExtension(databaseUrl);

  await runMigrations(databaseUrl, 'Reapply after rollback');
    await assertTableExists(databaseUrl, 'execution_traces');

    log('Rollback smoke test succeeded. Migrations can be re-applied cleanly after a drop.');
  } finally {
    if (container) {
      log('Stopping rollback container...');
      await container.stop();
    }
    if (originalPostgresPort) {
      process.env.POSTGRES_PORT = originalPostgresPort;
    } else {
      delete process.env.POSTGRES_PORT;
    }
  }
}

async function waitForDatabase(url: string, retries = 30) {
  log('Waiting for Postgres to accept connections...');
  for (let attempt = 1; attempt <= retries; attempt++) {
    const pool = new Pool({ connectionString: url });
    try {
      await pool.query('SELECT 1');
      await pool.end();
      log(`Postgres is ready after ${attempt} attempt(s).`);
      return;
    } catch (error) {
      await pool.end();
      if (attempt === retries) {
        throw error;
      }
      log(`Postgres not ready (attempt ${attempt}/${retries}): ${String(error)}. Retrying in 1s...`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

async function ensureVectorExtension(url: string) {
  log('Ensuring vector extension exists...');
  const pool = new Pool({ connectionString: url });
  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
    log('Vector extension ready.');
  } finally {
    await pool.end();
  }
}

async function runMigrations(url: string, label: string) {
  log(`${label}: running drizzle-kit push against ${url}`);
  const parsed = new URL(url);
  const env = {
    ...process.env,
    DATABASE_URL: url,
    POSTGRES_PORT: parsed.port || '5432',
  };
  await runCommand('npx', ['drizzle-kit', 'push'], env);
}

async function dropSchema(url: string) {
  log('Dropping and recreating public schema...');
  const pool = new Pool({ connectionString: url });
  try {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    log('Schema dropped and recreated.');
  } finally {
    await pool.end();
  }
}

async function assertTableExists(url: string, tableName: string) {
  log(`Verifying table '${tableName}' exists...`);
  const pool = new Pool({ connectionString: url });
  try {
    const result = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name = $1
       ) AS exists;`,
      [tableName]
    );
    const exists = result.rows?.[0]?.exists;
    if (exists !== true && exists !== 't') {
      throw new Error(`Expected table '${tableName}' to exist after migrations.`);
    }
    log(`Confirmed table '${tableName}' exists.`);
  } finally {
    await pool.end();
  }
}

function runCommand(command: string, args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<void>((resolve, reject) => {
    log(`Executing: ${command} ${args.join(' ')}`);
    const child = spawn(command, args, {
      cwd: projectRoot,
      env,
      stdio: 'inherit',
    });
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
      }
    });
    child.on('error', (error) => reject(error));
  });
}

function log(message: string) {
  const timestamp = new Date().toISOString();
  console.info(`[db:test:rollback][${timestamp}] ${message}`);
}

function configureDockerSocket() {
  if (process.env.DOCKER_HOST) {
    log(`DOCKER_HOST already set (${process.env.DOCKER_HOST})`);
    return;
  }

  const sockets: Array<{ hostPath: string; containerPath?: string }> = [
    { hostPath: path.join(os.homedir(), '.colima', 'default', 'docker.sock'), containerPath: '/var/run/docker.sock' },
    { hostPath: path.join(os.homedir(), '.docker', 'run', 'docker.sock') },
    { hostPath: '/var/run/docker.sock' },
  ];

  for (const { hostPath, containerPath } of sockets) {
    if (fs.existsSync(hostPath)) {
      process.env.DOCKER_HOST = `unix://${hostPath}`;
      log(`Detected Docker socket at ${hostPath}`);
      if (containerPath && !process.env.TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE) {
        process.env.TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE = containerPath;
        log(`Setting TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=${containerPath}`);
      }
      return;
    }
  }

  log('Warning: Could not auto-detect Docker socket. Testcontainers may hang.');
}

main().catch((error) => {
  console.error('❌ Rollback smoke test failed:', error);
  console.error('Environment snapshot:', {
    dockerHost: process.env.DOCKER_HOST,
    testcontainersHostOverride: process.env.TESTCONTAINERS_HOST_OVERRIDE,
  });
  process.exit(1);
});
