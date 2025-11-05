#!/usr/bin/env tsx
import { pool } from '../../src/db/client.js';

async function migrate() {
  console.log('🔄 Running migrations...');

  try {
    // Enable pgvector extension
    console.log('  - Enabling pgvector extension');
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector');

    // Create memory_type enum
    console.log('  - Creating memory_type enum');
    await pool.query(`
      DO $$ BEGIN
        CREATE TYPE memory_type AS ENUM ('episodic', 'semantic', 'procedural');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    // Let drizzle-kit push handle table creation
    console.log('  - Run: drizzle-kit push');
    console.log(
      '    This will create tables based on src/db/schema.ts'
    );

    // Optimize pgvector
    console.log('  - Optimizing pgvector');
    await pool.query(`
      -- Set STORAGE PLAIN on embedding column (avoid TOAST overhead)
      ALTER TABLE memories ALTER COLUMN embedding SET STORAGE PLAIN;

      -- Configure HNSW search parameters
      SET hnsw.ef_search = 100;
    `);

    // Create text search column and index
    console.log('  - Adding full-text search support');
    await pool.query(`
      ALTER TABLE memories ADD COLUMN IF NOT EXISTS textsearch tsvector
        GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;
      
      CREATE INDEX IF NOT EXISTS memories_textsearch_idx
        ON memories USING GIN(textsearch);
    `);

    console.log('✅ Migrations complete');
    console.log('\n📋 Next steps:');
    console.log('  1. Run: npm run db:migrate (drizzle-kit push)');
    console.log('  2. Run: npm run db:seed');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();

