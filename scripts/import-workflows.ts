#!/usr/bin/env tsx
import { N8nClient } from '../src/integrations/n8n/client.js';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from '../src/config/index.js';
import { WorkflowRegistryRepository } from '../src/db/repositories/workflow-registry-repository.js';
import { db } from '../src/db/client.js';
import { memories } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Map workflow file names to their display names for registry
 */
const WORKFLOW_NAME_MAP: Record<string, string> = {
  'casey.workflow.json': 'Casey (Showrunner)',
  'iggy.workflow.json': 'Iggy (Creative Director)',
  'riley.workflow.json': 'Riley (Head Writer)',
  'veo.workflow.json': 'Veo (Production)',
  'alex.workflow.json': 'Alex (Editor)',
  'quinn.workflow.json': 'Quinn (Publisher)',
};

function baseNameNoExt(filename: string) {
  return filename.replace(/\.workflow\.json$/i, '');
}

function normalizeWorkflowForImport(fileName: string, raw: any) {
  // n8n expects: { name, nodes, connections, settings?, pinData?, staticData?, meta? }
  const name = raw.name || baseNameNoExt(fileName);
  const { nodes, connections } = raw;
  return {
    name,
    nodes,
    connections,
    settings: raw.settings || {},
  };
}

async function importWorkflows() {
  console.log('🔄 Importing workflows to n8n...\n');

  const n8nClient = new N8nClient({
    baseUrl: config.n8n.baseUrl || 'http://localhost:5678',
    apiKey: config.n8n.apiKey,
  });

  const workflows = [
    { name: 'casey.workflow.json', path: join(__dirname, '../workflows/casey.workflow.json') },
    { name: 'iggy.workflow.json', path: join(__dirname, '../workflows/iggy.workflow.json') },
    { name: 'riley.workflow.json', path: join(__dirname, '../workflows/riley.workflow.json') },
    { name: 'veo.workflow.json', path: join(__dirname, '../workflows/veo.workflow.json') },
    { name: 'alex.workflow.json', path: join(__dirname, '../workflows/alex.workflow.json') },
    { name: 'quinn.workflow.json', path: join(__dirname, '../workflows/quinn.workflow.json') },
  ];

  const availableWorkflows = workflows.filter(({ path }) => existsSync(path));
  const missingWorkflows = workflows.filter(({ path }) => !existsSync(path));
  missingWorkflows.forEach(({ name }) => {
    console.log(`⚠️  Skipping ${name} (file not found — expected in workflows/).`);
  });

  const existingList = await n8nClient.listWorkflows();
  const existingByName = new Map<string, typeof existingList[number]>();
  for (const workflow of existingList) {
    const key = (workflow.name || '').trim().toLowerCase();
    if (!key) continue;
    const current = existingByName.get(key);
    if (!current) {
      existingByName.set(key, workflow);
      continue;
    }
    const currentDate = current.updatedAt ? Date.parse(current.updatedAt) : 0;
    const nextDate = workflow.updatedAt ? Date.parse(workflow.updatedAt) : 0;
    if (nextDate > currentDate) {
      existingByName.set(key, workflow);
    }
  }

  const results: Array<{ name: string; id: string; displayName: string; action: 'created' | 'updated' }> = [];

  for (const workflow of availableWorkflows) {
    try {
      console.log(`📥 Syncing ${workflow.name}...`);
      const workflowJson = JSON.parse(readFileSync(workflow.path, 'utf-8'));
      const payload = normalizeWorkflowForImport(workflow.name, workflowJson);
      const key = baseNameNoExt(workflow.name).toLowerCase();
      const existing = existingByName.get(key);

      let id: string;
      let action: 'created' | 'updated';

      if (existing) {
        id = existing.id;
        action = 'updated';
        await n8nClient.updateWorkflow(id, payload);
      } else {
        id = await n8nClient.importWorkflow(payload);
        action = 'created';
      }

      // Activate to register webhook endpoints
      try {
        await n8nClient.activateWorkflow(id);
      } catch (e) {
        console.warn(`   ⚠️  Could not auto-activate ${payload.name}. Please activate in UI.`);
      }
      const displayName = WORKFLOW_NAME_MAP[workflow.name] || workflow.name;
      results.push({ name: workflow.name, id, displayName, action });
      console.log(`   ✅ ${action === 'created' ? 'Imported' : 'Updated'}: ${id}\n`);
    } catch (error) {
      console.error(`   ❌ Failed to import ${workflow.name}:`, error);
      if (error instanceof Error) {
        console.error(`   Error: ${error.message}\n`);
      }
    }
  }

  console.log('\n📋 Import Summary:');
  console.log('─────────────────');
  results.forEach(({ name, id, displayName, action }) => {
    console.log(`${displayName} (${name}) [${action}]: ${id}`);
  });

  // Optionally register in workflow_registry if memory IDs are found
  const shouldRegister = process.env.REGISTER_WORKFLOWS === 'true';
  if (shouldRegister && results.length > 0) {
    console.log('\n🔄 Registering workflows in workflow_registry...\n');
    const registryRepository = new WorkflowRegistryRepository();

    // Get all procedural memories
    const allProceduralMemories = await db
      .select()
      .from(memories)
      .where(eq(memories.memoryType, 'procedural'));

    // Try to find matching procedural memories by name
    for (const { displayName, id: n8nId } of results) {
      try {
        // Find memory with matching workflow name in metadata
        const matchingMemory = allProceduralMemories.find((m) => {
          const workflow = m.metadata?.workflow as { name?: string } | undefined;
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
  } else if (results.length > 0) {
    console.log(
      '\n💡 To register workflows in workflow_registry:'
    );
    console.log('   1. Run: npm run db:seed:workflows');
    console.log('   2. Set REGISTER_WORKFLOWS=true');
    console.log('   3. Re-run: npm run import:workflows');
  }

  if (results.length > 0) {
    console.log('\n💡 Record these workflow IDs for observability (agent_webhooks metadata, docs, runbooks):');
    results.forEach(({ displayName, id }) => {
      const envVar = `N8N_WORKFLOW_ID_${displayName.toUpperCase().replace(/\s+/g, '_')}`;
      console.log(`   export ${envVar}=${id}`);
    });
  }
}

importWorkflows().catch((error) => {
  console.error('Failed to import workflows:', error);
  process.exit(1);
});
