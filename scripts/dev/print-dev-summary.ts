#!/usr/bin/env tsx

/**
 * print-dev-summary.ts
 *
 * Prints quick reference info for the local dev environment:
 *   • Service health checks (MCP + n8n)
 *   • Workflow IDs + activation status
 *   • Credential IDs from the dev database
 *
 * Run with: npm run workflow:dev:summary
 */

import { spawnSync } from 'child_process';
import { Pool } from 'pg';
import { config } from '../../src/config/index.js';

async function checkHealth(url: string, label: string) {
  try {
    const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
    if (!res.ok) {
      console.log(`❌ ${label} → HTTP ${res.status}`);
      return;
    }
    await res.json();
    console.log(`✅ ${label}`);
  } catch (error) {
    console.log(`❌ ${label} → ${String(error)}`);
  }
}

async function listWorkflows() {
  try {
    const res = await fetch(`${config.n8n.baseUrl}/api/v1/workflows`, {
      headers: { 'X-N8N-API-KEY': config.n8n.apiKey ?? '' },
    });
    if (!res.ok) {
      console.log(`⚠️  Unable to fetch workflows: HTTP ${res.status}`);
      return;
    }
    const data = await res.json();
    const rows = (data?.data ?? []) as Array<{ id: string; name: string; active: boolean }>;
    if (rows.length === 0) {
      console.log('⚠️  No workflows returned from n8n');
      return;
    }
    console.log('\n📋 Workflows');
    rows.forEach((wf) => {
      console.log(`  ${wf.active ? '✅' : '⚪️'}  ${wf.id}  ${wf.name}`);
    });
  } catch (error) {
    console.log(`⚠️  Failed to list workflows: ${String(error)}`);
  }
}

function buildN8nDatabaseUrl(): string | undefined {
  if (process.env.N8N_DATABASE_URL) {
    return process.env.N8N_DATABASE_URL;
  }
  const password = process.env.DB_PASSWORD;
  if (!password) return undefined;
  const port = process.env.POSTGRES_PORT ?? '5432';
  const encodedPassword = encodeURIComponent(password);
  return `postgresql://mylo:${encodedPassword}@localhost:${port}/n8n`;
}

async function listCredentials(databaseUrl?: string) {
  const connectionString = databaseUrl ?? buildN8nDatabaseUrl();
  if (!connectionString) {
    console.log('\n⚠️  Skipping credential list – set N8N_DATABASE_URL or DB_PASSWORD to enable');
    return;
  }
  const redacted = connectionString.replace(/:[^:@]+@/, ':***@');
  console.log(`\n🔐 Credentials (Postgres: ${redacted})`);
  const pool = new Pool({ connectionString });
  try {
    const dbName = await pool.query<{ current_database: string }>('SELECT current_database();');
    const currentDb = dbName.rows?.[0]?.current_database;
    if (currentDb) {
      console.log(`    ↳ current_database = ${currentDb}`);
    }
    const { rows } = await pool.query<{ id: string; name: string; type: string }>(
      'SELECT id, name, type FROM public.credentials_entity ORDER BY type, name;'
    );
    if (rows.length === 0) {
      console.log('⚠️  No credentials stored in database');
      return;
    }
    rows.forEach((row) => {
      console.log(`  ${row.type.padEnd(20)} ${row.id}  ${row.name}`);
    });
  } catch (error) {
    console.log(`\n⚠️  Failed to query credentials directly: ${String(error)}`);
    console.log('   Attempting docker fallback (docker exec mcp-postgres psql ...)\n');
    const fallback = spawnSync(
      'docker',
      [
        'exec',
        'mcp-postgres',
        'psql',
        '-U',
        'mylo',
        '-d',
        'n8n',
        '-t',
        '-A',
        '-F',
        ',',
        '-c',
        'SELECT type, id, name FROM public.credentials_entity ORDER BY type, name;',
      ],
      { encoding: 'utf-8' }
    );
    if (fallback.status === 0 && fallback.stdout.trim().length > 0) {
      fallback.stdout
        .trim()
        .split('\n')
        .forEach((line) => {
          const [type, id, name] = line.split(',');
          console.log(`  ${type.padEnd(20)} ${id}  ${name}`);
        });
    } else {
      console.log('   ⚠️  Docker fallback failed – ensure containers are running.');
      if (fallback.stderr) {
        console.log(`   ${fallback.stderr.trim()}`);
      }
    }
  } finally {
    await pool.end().catch(() => {});
  }
}

async function main() {
  console.log('🧭 Dev Environment Summary\n');

  await checkHealth('http://localhost:3456/health', 'MCP health');
  await checkHealth(`${config.n8n.baseUrl}/healthz`, 'n8n health');

  await listWorkflows();
  await listCredentials(process.env.N8N_DATABASE_URL);

  console.log('');
}

main().catch((error) => {
  console.error('❌ Summary script failed:', error);
  process.exit(1);
});

