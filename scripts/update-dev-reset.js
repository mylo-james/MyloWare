#!/usr/bin/env node

/**
 * Update dev-reset.sql with generated prompts
 *
 * This script:
 * 1. Reads the generated prompts-inserts.sql
 * 2. Replaces the prompts section in dev-reset.sql
 * 3. Preserves all other parts of dev-reset.sql
 */

const fs = require('fs');
const path = require('path');

const DEV_RESET_FILE = path.join(__dirname, '../sql/dev-reset.sql');
const PROMPTS_INSERTS_FILE = path.join(__dirname, '../sql/prompts-inserts.sql');

// Markers to identify the prompts section
const START_MARKER = '-- Insert Prompts using new simplified schema';
const END_MARKER = '-- Seed example row matching expected AISMR structure';

/**
 * Update dev-reset.sql with new prompts
 */
function updateDevReset() {
  console.log('📖 Reading files...');

  // Read both files
  const devResetContent = fs.readFileSync(DEV_RESET_FILE, 'utf8');
  const promptsInserts = fs.readFileSync(PROMPTS_INSERTS_FILE, 'utf8');

  // Find the section to replace
  const startIdx = devResetContent.indexOf(START_MARKER);
  const endIdx = devResetContent.indexOf(END_MARKER);

  if (startIdx === -1) {
    console.error('❌ Could not find start marker in dev-reset.sql');
    console.error(`   Looking for: "${START_MARKER}"`);
    process.exit(1);
  }

  if (endIdx === -1) {
    console.error('❌ Could not find end marker in dev-reset.sql');
    console.error(`   Looking for: "${END_MARKER}"`);
    process.exit(1);
  }

  if (endIdx <= startIdx) {
    console.error('❌ End marker appears before start marker in dev-reset.sql');
    process.exit(1);
  }

  console.log('✅ Found prompts section in dev-reset.sql');

  // Build the new content
  const before = devResetContent.substring(0, startIdx);
  const after = devResetContent.substring(endIdx);

  const newContent = `${before}${START_MARKER}
-- Format: persona_id, project_id, prompt_text, display_order, prompt_type

${promptsInserts}
${after}`;

  // Write the updated file
  fs.writeFileSync(DEV_RESET_FILE, newContent, 'utf8');

  console.log('✨ Updated dev-reset.sql successfully!');
  console.log(`   📄 File: ${DEV_RESET_FILE}`);

  // Show stats
  const oldLines = devResetContent.split('\n').length;
  const newLines = newContent.split('\n').length;
  const diff = newLines - oldLines;

  console.log(
    `   📊 Lines: ${oldLines} → ${newLines} (${diff > 0 ? '+' : ''}${diff})`
  );
}

// Run the script
try {
  updateDevReset();
} catch (error) {
  console.error('❌ Error:', error.message);
  console.error(error.stack);
  process.exit(1);
}
