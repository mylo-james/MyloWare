#!/usr/bin/env tsx
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function seed() {
  console.log('🌱 Seeding development data...');
  console.log('   (Running migrations to populate personas, projects, and workflows)');

  try {
    // Run persona migration
    await execAsync('npm run migrate:personas');

    // Run project migration
    await execAsync('npm run migrate:projects');

    // Run workflow migration
    await execAsync('npm run migrate:workflows');

    console.log('✅ Development data seeded');
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  }
}

seed();

