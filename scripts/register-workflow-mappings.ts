#!/usr/bin/env tsx
import { MemoryRepository } from '../src/db/repositories/memory-repository.js';

/**
 * Register semantic workflow memories with their n8n workflow implementations
 * 
 * Update the n8nWorkflowId values with the actual IDs from your n8n instance
 */
async function registerWorkflowMappings() {
  console.log('🔄 Registering workflow mappings...\n');

  const memories = new MemoryRepository();

  // Define mappings: semantic memory ID → n8n workflow ID
  const mappings = [
    {
      memoryId: 'ff339ee5-272e-4626-9dae-57bc34bb49ee',
      name: 'Generate Ideas',
      n8nWorkflowId: process.env.N8N_WORKFLOW_ID_GENERATE_IDEAS || '', // Set this
    },
    {
      memoryId: 'cc55a52b-b7b0-4e75-ba9d-02b082d5c62c',
      name: 'Write Script',
      n8nWorkflowId: process.env.N8N_WORKFLOW_ID_WRITE_SCRIPT || '', // Set this
    },
    {
      memoryId: '6e36db85-72a0-4e9a-91e9-4941133e4864',
      name: 'Make Videos',
      n8nWorkflowId: process.env.N8N_WORKFLOW_ID_MAKE_VIDEOS || 'PQsePXjhfSVfw6zb', // Using Generate Video from agent
    },
    {
      memoryId: '2237b088-d579-4bd4-8106-f9e6318a8518',
      name: 'Post Video',
      n8nWorkflowId: process.env.N8N_WORKFLOW_ID_POST_VIDEO || 'uIWB6d8OslTpJl1G', // Using Upload to TikTok from agent
    },
  ];

  for (const mapping of mappings) {
    try {
      if (!mapping.n8nWorkflowId) {
        console.log(`⚠️  Skipping "${mapping.name}" - no n8n workflow ID provided`);
        console.log(`   Set N8N_WORKFLOW_ID_${mapping.name.toUpperCase().replace(/\s+/g, '_')} env var\n`);
        continue;
      }

      const memory = await memories.findById(mapping.memoryId);
      if (!memory) {
        console.log(`❌ Memory not found for "${mapping.name}" (${mapping.memoryId})\n`);
        continue;
      }

      const metadata = {
        ...(memory.metadata || {}),
        n8nWorkflowId: mapping.n8nWorkflowId,
      };

      await memories.update(memory.id, { metadata });

      console.log(`✅ Registered "${mapping.name}"`);
      console.log(`   Memory ID: ${mapping.memoryId}`);
      console.log(`   n8n ID: ${mapping.n8nWorkflowId}\n`);
    } catch (error) {
      console.error(`❌ Failed to register "${mapping.name}":`, error);
      if (error instanceof Error) {
        console.error(`   Error: ${error.message}\n`);
      }
    }
  }

  console.log('✅ Registration complete!');
}

registerWorkflowMappings().catch((error) => {
  console.error('Failed to register workflow mappings:', error);
  process.exit(1);
});
