#!/usr/bin/env tsx
import { N8nClient } from '../src/integrations/n8n/client.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from '../src/config/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
      path: join(__dirname, '../../v1/workflows/edit-aismr.workflow.json'),
    },
    {
      name: 'generate-video.workflow.json',
      path: join(__dirname, '../../v1/workflows/generate-video.workflow.json'),
    },
  ];

  const imported: Array<{ name: string; id: string }> = [];

  for (const workflow of workflows) {
    try {
      console.log(`📥 Importing ${workflow.name}...`);
      const workflowJson = JSON.parse(readFileSync(workflow.path, 'utf-8'));
      const id = await n8nClient.importWorkflow(workflowJson);
      imported.push({ name: workflow.name, id });
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
  imported.forEach(({ name, id }) => {
    console.log(`${name}: ${id}`);
  });

  if (imported.length > 0) {
    console.log('\n💡 Update agent.workflow.json toolWorkflow nodes with these IDs');
  }
}

importWorkflows().catch((error) => {
  console.error('Failed to import workflows:', error);
  process.exit(1);
});

