#!/usr/bin/env node

/**
 * Test script to validate the prompt build system
 */

const fs = require('fs');
const path = require('path');

const PROMPTS_DIR = path.join(__dirname, '../prompts');
const PROMPTS_INSERTS_FILE = path.join(__dirname, '../sql/prompts-inserts.sql');
const DEV_RESET_FILE = path.join(__dirname, '../sql/dev-reset.sql');

console.log('🧪 Testing prompt build system...\n');

let errors = 0;

// Test 1: Check prompts directory exists
console.log('📁 Test 1: Prompts directory exists');
if (!fs.existsSync(PROMPTS_DIR)) {
  console.error('   ❌ FAIL: prompts/ directory not found');
  errors++;
} else {
  console.log('   ✅ PASS');
}

// Test 2: Check for markdown files
console.log('📄 Test 2: Markdown files exist');
const mdFiles = fs
  .readdirSync(PROMPTS_DIR)
  .filter(
    (f) => f.endsWith('.md') && !f.startsWith('bak.') && f !== 'README.md'
  );
if (mdFiles.length === 0) {
  console.error('   ❌ FAIL: No markdown files found in prompts/');
  errors++;
} else {
  console.log(`   ✅ PASS: Found ${mdFiles.length} markdown files`);
}

// Test 3: Check generated SQL exists
console.log('📝 Test 3: Generated SQL file exists');
if (!fs.existsSync(PROMPTS_INSERTS_FILE)) {
  console.error(
    '   ❌ FAIL: prompts-inserts.sql not found (run npm run build:prompts)'
  );
  errors++;
} else {
  console.log('   ✅ PASS');
}

// Test 4: Validate SQL content
console.log('🔍 Test 4: SQL content validation');
if (fs.existsSync(PROMPTS_INSERTS_FILE)) {
  const sql = fs.readFileSync(PROMPTS_INSERTS_FILE, 'utf8');
  const insertCount = (sql.match(/INSERT INTO prompts/g) || []).length;

  if (insertCount !== mdFiles.length) {
    console.error(
      `   ❌ FAIL: Expected ${mdFiles.length} INSERT statements, found ${insertCount}`
    );
    errors++;
  } else {
    console.log(`   ✅ PASS: ${insertCount} INSERT statements generated`);
  }
}

// Test 5b: Validate persona/project ID combinations in generated SQL
console.log('🧩 Test 5b: Validate ID combinations (persona/project)');
if (fs.existsSync(PROMPTS_INSERTS_FILE)) {
  const sql = fs.readFileSync(PROMPTS_INSERTS_FILE, 'utf8');
  const pairRegex = /\(\s*(NULL|\(SELECT id FROM personas[^)]*\))\s*,\s*(NULL|\(SELECT id FROM projects[^)]*\))\s*,/g;
  let m;
  let personaOnly = 0;
  let projectOnly = 0;
  let bothIds = 0;
  let bothNull = 0;

  while ((m = pairRegex.exec(sql)) !== null) {
    const left = m[1];
    const right = m[2];
    const leftIsPersona = left.startsWith('(SELECT id FROM personas');
    const rightIsProject = right.startsWith('(SELECT id FROM projects');
    const leftIsNull = left === 'NULL';
    const rightIsNull = right === 'NULL';

    if (leftIsPersona && rightIsNull) personaOnly++;
    else if (leftIsNull && rightIsProject) projectOnly++;
    else if (leftIsPersona && rightIsProject) bothIds++;
    else if (leftIsNull && rightIsNull) bothNull++;
  }

  if (bothNull > 0) {
    console.error(`   ❌ FAIL: Found ${bothNull} INSERT(s) with both persona_id and project_id NULL`);
    errors++;
  }
  if (bothIds < 1) {
    console.error('   ❌ FAIL: Expected at least one persona-project INSERT (both IDs set)');
    errors++;
  }
  if (personaOnly < 1) {
    console.error('   ❌ FAIL: Expected at least one persona-only INSERT (persona_id set, project_id NULL)');
    errors++;
  }
  if (projectOnly < 1) {
    console.error('   ❌ FAIL: Expected at least one project-only INSERT (project_id set, persona_id NULL)');
    errors++;
  }

  if (errors === 0) {
    console.log(
      `   ✅ PASS: ${personaOnly} persona-only, ${projectOnly} project-only, ${bothIds} persona-project`
    );
  }
}

// Test 5: Check dev-reset.sql was updated
console.log('🔄 Test 5: dev-reset.sql contains generated prompts');
if (fs.existsSync(DEV_RESET_FILE)) {
  const devReset = fs.readFileSync(DEV_RESET_FILE, 'utf8');

  if (!devReset.includes('AUTO-GENERATED PROMPTS INSERTS')) {
    console.error('   ❌ FAIL: dev-reset.sql missing auto-generated header');
    errors++;
  } else if (!devReset.includes('PERSONA-LEVEL PROMPTS')) {
    console.error('   ❌ FAIL: dev-reset.sql missing persona prompts section');
    errors++;
  } else {
    console.log('   ✅ PASS');
  }
}

// Test 5c: Validate ID combinations inside dev-reset.sql
console.log('🧩 Test 5c: Validate ID combinations in dev-reset.sql');
if (fs.existsSync(DEV_RESET_FILE)) {
  const sql = fs.readFileSync(DEV_RESET_FILE, 'utf8');
  const pairRegex = /\(\s*(NULL|\(SELECT id FROM personas[^)]*\))\s*,\s*(NULL|\(SELECT id FROM projects[^)]*\))\s*,/g;
  let m;
  let personaOnly = 0;
  let projectOnly = 0;
  let bothIds = 0;
  let bothNull = 0;

  while ((m = pairRegex.exec(sql)) !== null) {
    const left = m[1];
    const right = m[2];
    const leftIsPersona = left.startsWith('(SELECT id FROM personas');
    const rightIsProject = right.startsWith('(SELECT id FROM projects');
    const leftIsNull = left === 'NULL';
    const rightIsNull = right === 'NULL';

    if (leftIsPersona && rightIsNull) personaOnly++;
    else if (leftIsNull && rightIsProject) projectOnly++;
    else if (leftIsPersona && rightIsProject) bothIds++;
    else if (leftIsNull && rightIsNull) bothNull++;
  }

  if (bothNull > 0) {
    console.error(`   ❌ FAIL: dev-reset.sql has ${bothNull} INSERT(s) with both IDs NULL`);
    errors++;
  }
  if (bothIds < 1 || personaOnly < 1 || projectOnly < 1) {
    console.error(
      '   ❌ FAIL: dev-reset.sql missing one or more expected INSERT categories'
    );
    errors++;
  } else if (errors === 0) {
    console.log(
      `   ✅ PASS: ${personaOnly} persona-only, ${projectOnly} project-only, ${bothIds} persona-project`
    );
  }
}

// Test 5d: Validate ID combinations in migrations with generated prompts
console.log('🧩 Test 5d: Validate ID combinations in supabase/migrations/*.sql');
try {
  const MIGRATIONS_DIR = path.join(__dirname, '../supabase/migrations');
  if (fs.existsSync(MIGRATIONS_DIR)) {
    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'));
    for (const f of files) {
      const full = path.join(MIGRATIONS_DIR, f);
      const sql = fs.readFileSync(full, 'utf8');
      if (!sql.includes('AUTO-GENERATED PROMPTS INSERTS')) continue; // skip unrelated migrations

      const pairRegex = /\(\s*(NULL|\(SELECT id FROM personas[^)]*\))\s*,\s*(NULL|\(SELECT id FROM projects[^)]*\))\s*,/g;
      let m;
      let personaOnly = 0;
      let projectOnly = 0;
      let bothIds = 0;
      let bothNull = 0;

      while ((m = pairRegex.exec(sql)) !== null) {
        const left = m[1];
        const right = m[2];
        const leftIsPersona = left.startsWith('(SELECT id FROM personas');
        const rightIsProject = right.startsWith('(SELECT id FROM projects');
        const leftIsNull = left === 'NULL';
        const rightIsNull = right === 'NULL';

        if (leftIsPersona && rightIsNull) personaOnly++;
        else if (leftIsNull && rightIsProject) projectOnly++;
        else if (leftIsPersona && rightIsProject) bothIds++;
        else if (leftIsNull && rightIsNull) bothNull++;
      }

      if (bothNull > 0 || bothIds < 1 || personaOnly < 1 || projectOnly < 1) {
        console.error(
          `   ❌ FAIL: ${f} has invalid/missing INSERT categories (personaOnly=${personaOnly}, projectOnly=${projectOnly}, both=${bothIds}, bothNull=${bothNull})`
        );
        errors++;
      } else {
        console.log(
          `   ✅ PASS (${f}): ${personaOnly} persona-only, ${projectOnly} project-only, ${bothIds} persona-project`
        );
      }
    }
  }
} catch (e) {
  console.error('   ❌ FAIL: Error scanning migrations', e.message);
  errors++;
}

// Test 6: Validate naming conventions
console.log('🏷️  Test 6: File naming conventions');
for (const file of mdFiles) {
  const base = file.replace('.md', '');
  const parts = base.split('-');

  let valid = false;
  if (parts[0] === 'persona' && parts.length === 2) valid = true;
  if (parts[0] === 'project' && parts.length === 2) valid = true;
  if (parts.length === 2 && parts[0] !== 'persona' && parts[0] !== 'project')
    valid = true;

  if (!valid) {
    console.error(`   ❌ WARNING: ${file} doesn't follow naming convention`);
    // Don't increment errors, just warn
  }
}
console.log('   ✅ PASS');

// Summary
console.log('\n' + '='.repeat(50));
if (errors === 0) {
  console.log('✨ All tests passed!');
  console.log('\n💡 Usage:');
  console.log('   npm run build:prompts      - Generate SQL from .md files');
  console.log('   npm run update:dev-reset   - Update dev-reset.sql');
  process.exit(0);
} else {
  console.error(`❌ ${errors} test(s) failed`);
  process.exit(1);
}
