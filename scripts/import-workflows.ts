#!/usr/bin/env tsx
import { N8nClient } from '../src/integrations/n8n/client.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from '../src/config/index.js';
import { WorkflowRunRepository } from '../src/db/repositories/workflow-run-repository.js';
import { db } from '../src/db/client.js';
import { memories } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Map workflow file names to their display names for registry
 */
const WORKFLOW_NAME_MAP: Record<string, string> = {
  'agent.workflow.json': 'AI Agent',
  'edit-aismr.workflow.json': 'Edit AISMR',
  'generate-video.workflow.json': 'Generate Video',
};

async function importWorkflows() {
  console.log('🔄 Importing workflows to n8n...\n');

  const n8nClient = new N8nClient({
    baseUrl: config.n8n.baseUrl || 'http://localhost:5678',
    apiKey: config.n8n.apiKey,
  });

  const workflows = [
    {
      name: 'agent.workflow.json',
      path: join(__dirname, '../workflows/agent.workflow.json'),
    },
    {
      name: 'edit-aismr.workflow.json',
      path: join(__dirname, '../workflows/edit-aismr.workflow.json'),
    },
    {
      name: 'generate-video.workflow.json',
      path: join(__dirname, '../workflows/generate-video.workflow.json'),
    },
  ];

  const imported: Array<{ name: string; id: string; displayName: string }> = [];

  for (const workflow of workflows) {
    try {
      console.log(`📥 Importing ${workflow.name}...`);
      const workflowJson = JSON.parse(readFileSync(workflow.path, 'utf-8'));
      const id = await n8nClient.importWorkflow(workflowJson);
      const displayName = WORKFLOW_NAME_MAP[workflow.name] || workflow.name;
      imported.push({ name: workflow.name, id, displayName });
      console.log(`   ✅ Imported: ${id}\n`);
    } catch (error) {
      console.error(`   ❌ Failed to import ${workflow.name}:`, error);
      if (error instanceof Error) {
        console.error(`   Error: ${error.message}\n`);
      }
    }
  }

  console.log('\n📋 Import Summary:');
  console.log('─────────────────');
  imported.forEach(({ name, id, displayName }) => {
    console.log(`${displayName} (${name}): ${id}`);
  });

  // Optionally register in workflow_registry if memory IDs are found
  const shouldRegister = process.env.REGISTER_WORKFLOWS === 'true';
  if (shouldRegister && imported.length > 0) {
    console.log('\n🔄 Registering workflows in workflow_registry...\n');
    const registryRepository = new WorkflowRunRepository();

    // Get all procedural memories
    const allProceduralMemories = await db
      .select()
      .from(memories)
      .where(eq(memories.memoryType, 'procedural'));

    // Try to find matching procedural memories by name
    for (const { displayName, id: n8nId } of imported) {
      try {
        // Find memory with matching workflow name in metadata
        const matchingMemory = allProceduralMemories.find((m) => {
          const workflow = m.metadata?.workflow as
            | { name?: string }
            | undefined;
          return workflow?.name === displayName;
        });

        if (matchingMemory) {
          // Check if already registered
          const existing = await registryRepository.findByMemoryId(
            matchingMemory.id
          );
          if (existing) {
            console.log(
              `   ⚠️  ${displayName} already registered (memory: ${matchingMemory.id})`
            );
          } else {
            await registryRepository.create({
              memoryId: matchingMemory.id,
              n8nWorkflowId: n8nId,
              name: displayName,
              isActive: true,
            });
            console.log(
              `   ✅ Registered ${displayName} (memory: ${matchingMemory.id}, n8n: ${n8nId})`
            );
          }
        } else {
          console.log(
            `   ⚠️  No matching procedural memory found for ${displayName}`
          );
          console.log(
            `      Run 'npm run db:seed:workflows' first to create procedural memories`
          );
        }
      } catch (error) {
        console.error(`   ❌ Failed to register ${displayName}:`, error);
        if (error instanceof Error) {
          console.error(`   Error: ${error.message}`);
        }
      }
    }
  } else if (imported.length > 0) {
    console.log('\n💡 To register workflows in workflow_registry:');
    console.log('   1. Run: npm run db:seed:workflows');
    console.log('   2. Set REGISTER_WORKFLOWS=true');
    console.log('   3. Re-run: npm run import:workflows');
  }

  if (imported.length > 0) {
    console.log(
      '\n💡 Update agent.workflow.json toolWorkflow nodes with these IDs'
    );
    console.log('\n💡 Export these IDs as environment variables for seeding:');
    imported.forEach(({ displayName, id }) => {
      const envVar = `N8N_WORKFLOW_ID_${displayName.toUpperCase().replace(/\s+/g, '_')}`;
      console.log(`   export ${envVar}=${id}`);
    });
  }
}

importWorkflows().catch((error) => {
  console.error('Failed to import workflows:', error);
  process.exit(1);
});
