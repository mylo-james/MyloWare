#!/usr/bin/env tsx
/**
 * General utilities and maintenance scripts
 * Usage: tsx scripts/utilities.ts <command>
 * Commands: search-vector, search-keyword, show-chunks, archive-videos, backfill-episodic, migrate-memory-types, summarize-episodic
 */

import { spawn } from 'node:child_process';

const commands = {
  'search-vector': './scripts/tools/runVectorSearch.ts',
  'search-keyword': './scripts/tools/runPromptKeywordSearch.ts',
  'show-chunks': './scripts/tools/showPromptChunks.ts',
  'archive-videos': './scripts/archiveAismrVideos.ts',
  'backfill-episodic': './scripts/backfillRunsToEpisodic.ts',
  'migrate-memory-types': './scripts/migrateMemoryTypes.ts',
  'summarize-episodic': './scripts/summarizeEpisodicMemory.ts',
};

function showHelp() {
  console.log('General Utilities');
  console.log('');
  console.log('Usage: tsx scripts/utilities.ts <command> [args...]');
  console.log('');
  console.log('Search Tools:');
  console.log('  search-vector <query>    - Search prompts using vector similarity');
  console.log('  search-keyword <query>   - Search prompts using keyword matching');
  console.log('  show-chunks <id>         - Show chunks for a specific prompt');
  console.log('');
  console.log('Maintenance:');
  console.log('  archive-videos           - Archive old AISMR videos');
  console.log('  backfill-episodic        - Backfill workflow runs to episodic memory');
  console.log('  migrate-memory-types     - Migrate memory type structure');
  console.log('  summarize-episodic       - Summarize episodic memory');
  console.log('');
}

async function runScript(scriptPath: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('tsx', [scriptPath, ...args], {
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

  const args = process.argv.slice(3);

  try {
    await runScript(scriptPath, args);
  } catch (error) {
    console.error('Failed:', error);
    process.exit(1);
  }
}

main();
