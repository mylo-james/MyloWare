#!/usr/bin/env tsx
import { pool } from '../../src/db/client.js';

async function reset() {
  console.log('🔄 Resetting database...');

  try {
    // Drop all tables
    await pool.query(`
      DROP SCHEMA public CASCADE;
      CREATE SCHEMA public;
    `);

    console.log('✅ Database reset complete');
  } catch (error) {
    console.error('❌ Database reset failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

reset();
