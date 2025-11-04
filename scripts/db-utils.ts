#!/usr/bin/env tsx
/**
 * Database utilities - migrations, ingest, and maintenance
 * Usage: tsx scripts/db-utils.ts <command>
 * Commands: migrate, migrate-ops, ingest, wipe-ops
 */

import { spawn } from 'node:child_process';

const commands = {
  migrate: './scripts/runMigrations.ts',
  'migrate-ops': './scripts/runOperationsMigrations.ts',
  ingest: './scripts/ingestPrompts.ts',
  'wipe-ops': './scripts/wipeOperationsDb.ts',
};

function showHelp() {
  console.log('Database Utilities');
  console.log('');
  console.log('Usage: tsx scripts/db-utils.ts <command>');
  console.log('');
  console.log('Commands:');
  console.log('  migrate      - Run main database migrations');
  console.log('  migrate-ops  - Run operations database migrations');
  console.log('  ingest       - Ingest prompts from prompts/ directory');
  console.log('  wipe-ops     - Wipe operations database (⚠️  destructive)');
  console.log('');
}

async function runScript(scriptPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('tsx', [scriptPath], {
      stdio: 'inherit',
      cwd: process.cwd(),
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Script exited with code ${code}`));
      }
    });
  });
}

async function main() {
  const command = process.argv[2];

  if (!command || command === '--help' || command === '-h') {
    showHelp();
    process.exit(0);
  }

  const scriptPath = commands[command as keyof typeof commands];

  if (!scriptPath) {
    console.error(`Unknown command: ${command}`);
    console.error('');
    showHelp();
    process.exit(1);
  }

  try {
    await runScript(scriptPath);
  } catch (error) {
    console.error('Failed:', error);
    process.exit(1);
  }
}

main();
