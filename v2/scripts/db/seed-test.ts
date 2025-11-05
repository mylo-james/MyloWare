#!/usr/bin/env tsx
import { testMemories } from './seed-data/memories.js';
import { storeMemory } from '../../src/tools/memory/storeTool.js';
import { pool } from '../../src/db/client.js';

async function seedTest() {
  console.log('🧪 Seeding test fixtures...');

  try {
    // Seed test memories
    for (const memory of testMemories) {
      await storeMemory({
        content: memory.content,
        memoryType: memory.memoryType,
        persona: memory.persona,
        project: memory.project,
        tags: memory.tags,
        metadata: memory.metadata,
      });
      console.log(`  ✓ Memory: ${memory.content.substring(0, 50)}...`);
    }

    console.log('✅ Test fixtures seeded');
  } catch (error) {
    console.error('❌ Test seeding failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seedTest();

