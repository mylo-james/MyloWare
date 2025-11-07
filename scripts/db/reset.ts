#!/usr/bin/env tsx
import { pool } from '../../src/db/client.js';

async function reset() {
  // Require --force flag
  const args = process.argv.slice(2);
  if (!args.includes('--force')) {
    console.error('❌ Database reset requires --force flag for safety.');
    console.error('   Usage: npm run db:reset -- --force');
    process.exit(1);
  }

  console.log('🔄 Resetting database...');

  try {
    // Drop all tables
    await pool.query(`
      DROP SCHEMA public CASCADE;
      CREATE SCHEMA public;
    `);

    // Ensure vector extension is created
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector;');

    console.log('✅ Database reset complete');
    console.log(`⚠️  Database URL: ${process.env.DATABASE_URL || 'not set'}`);
  } catch (error) {
    console.error('❌ Database reset failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

reset();
