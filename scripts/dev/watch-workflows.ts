#!/usr/bin/env tsx

/**
 * watch-workflows.ts
 *
 * Watches the local `workflows/` directory and automatically pushes changes
 * into the dev n8n instance. Helpful when iterating on workflow JSON locally.
 *
 * Usage:
 *   npm run workflow:dev:watch
 *
 * The script debounces rapid changes, ensures only one sync runs at a time,
 * and prints success/failure status for each sync attempt.
 */

import { watch } from 'fs';
import { spawn } from 'child_process';
import path from 'path';

const workflowsDir = path.join(process.cwd(), 'workflows');

if (!process.stdout.isTTY) {
  console.log('🔁 Watching workflows (non-TTY mode)...');
}

console.log('👀  Watching for workflow changes in', workflowsDir);
console.log('    On change → npm run workflow:dev:refresh');

let debounceTimer: NodeJS.Timeout | null = null;
let isSyncRunning = false;
let pendingSync = false;

function runSync() {
  if (isSyncRunning) {
    pendingSync = true;
    return;
  }

  isSyncRunning = true;
  pendingSync = false;

  console.log('\n📤  Syncing workflows to dev n8n...');
  const child = spawn('npm', ['run', 'workflow:dev:refresh'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  child.on('exit', (code) => {
    isSyncRunning = false;
    if (code === 0) {
      console.log('✅  Workflows synced successfully');
    } else {
      console.log(`❌  Workflow sync failed (exit code ${code ?? 'unknown'})`);
    }

    if (pendingSync) {
      console.log('🔁  Pending changes detected, syncing again...');
      runSync();
    }
  });
}

function scheduleSync(trigger: string) {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    console.log(`\n🔔  Detected changes (${trigger}), preparing to sync...`);
    runSync();
  }, 400);
}

watch(workflowsDir, { recursive: true }, (eventType, filename) => {
  if (!filename) return;
  if (!filename.endsWith('.workflow.json')) return;
  scheduleSync(`${eventType}: ${filename}`);
});

process.on('SIGINT', () => {
  console.log('\n👋  Stopping workflow watcher');
  process.exit(0);
});

