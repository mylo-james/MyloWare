#!/usr/bin/env node

/**
 * Generate a fresh copy of sql/dev-reset.sql and print it so it can be pasted
 * directly into Supabase.
 *
 * Steps:
 * 1. Rebuild prompt inserts (node scripts/build-prompts-sql.js)
 * 2. Update sql/dev-reset.sql with those inserts
 * 3. Print the full SQL to stdout with clear delimiters
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DEV_RESET_FILE = path.join(__dirname, '../sql/dev-reset.sql');

function run(command, args, label) {
  console.log(`\n🔧 ${label}`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    console.error(`\n❌ Failed while running ${command} ${args.join(' ')}`);
    process.exit(result.status || 1);
  }
}

function ensureDevResetExists() {
  if (!fs.existsSync(DEV_RESET_FILE)) {
    console.error(`❌ Missing file: ${DEV_RESET_FILE}`);
    console.error('   Run npm run build:prompts first to generate it.');
    process.exit(1);
  }
}

function printSql() {
  const sql = fs.readFileSync(DEV_RESET_FILE, 'utf8');
  console.log('\n====================== COPY BELOW ======================\n');
  console.log(sql);
  console.log('\n====================== COPY ABOVE ======================\n');
  console.log(`📄 Source file: ${DEV_RESET_FILE}`);
}

function main() {
  run('node', ['scripts/build-prompts-sql.js'], 'Regenerating prompt inserts');
  run('node', ['scripts/update-dev-reset.js'], 'Updating sql/dev-reset.sql');
  ensureDevResetExists();
  printSql();
}

main();
