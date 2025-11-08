#!/usr/bin/env tsx
import { N8nClient } from '../src/integrations/n8n/client.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from '../src/config/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Map workflow file names to their display names for registry
 */
const WORKFLOW_NAME_MAP: Record<string, string> = {
  'myloware-agent.workflow.json': 'Myloware Agent',
  'edit-aismr.workflow.json': 'Edit AISMR',
  'generate-video.workflow.json': 'Generate Video',
  'upload-file-to-google-drive.workflow.json': 'Upload File to Google Drive',
  'upload-to-tiktok.workflow.json': 'Upload to TikTok',
  'mcp-health-check.workflow.json': 'MCP Health Check',
  'error-handler.workflow.json': 'Error Handler',
};

async function importWorkflows() {
  console.log('🔄 Importing workflows to n8n...\n');

  const n8nClient = new N8nClient({
    baseUrl: config.n8n.baseUrl || 'http://localhost:5678',
    apiKey: config.n8n.apiKey,
  });

  const workflows = [
    {
      name: 'myloware-agent.workflow.json',
      path: join(__dirname, '../workflows/myloware-agent.workflow.json'),
    },
    {
      name: 'edit-aismr.workflow.json',
      path: join(__dirname, '../workflows/edit-aismr.workflow.json'),
    },
    {
      name: 'generate-video.workflow.json',
      path: join(__dirname, '../workflows/generate-video.workflow.json'),
    },
    {
      name: 'upload-file-to-google-drive.workflow.json',
      path: join(
        __dirname,
        '../workflows/upload-file-to-google-drive.workflow.json'
      ),
    },
    {
      name: 'upload-to-tiktok.workflow.json',
      path: join(__dirname, '../workflows/upload-to-tiktok.workflow.json'),
    },
    {
      name: 'mcp-health-check.workflow.json',
      path: join(__dirname, '../workflows/mcp-health-check.workflow.json'),
    },
    {
      name: 'error-handler.workflow.json',
      path: join(__dirname, '../workflows/error-handler.workflow.json'),
    },
  ];

  const existing = await n8nClient.listWorkflows(250);
  const existingByName = new Map(existing.map((wf) => [wf.name, wf]));

  const created: Array<{ name: string; id: string; displayName: string }> = [];
  const updated: Array<{ name: string; id: string; displayName: string }> = [];

  for (const workflow of workflows) {
    try {
      console.log(`📥 Importing ${workflow.name}...`);
      const rawWorkflow = JSON.parse(readFileSync(workflow.path, 'utf-8'));

      const displayName = WORKFLOW_NAME_MAP[workflow.name] || workflow.name;

      const sanitizedWorkflow: Record<string, unknown> = {
        name:
          typeof rawWorkflow.name === 'string' && rawWorkflow.name.length > 0
            ? rawWorkflow.name
            : displayName,
        nodes: rawWorkflow.nodes ?? [],
        connections: rawWorkflow.connections ?? {},
        settings:
          rawWorkflow.settings && typeof rawWorkflow.settings === 'object'
            ? rawWorkflow.settings
            : {},
      };

      console.log(
        `   Payload keys: ${Object.keys(sanitizedWorkflow).join(', ')}`
      );

      const existingWorkflow = existingByName.get(
        sanitizedWorkflow.name as string
      );

      if (existingWorkflow) {
        await n8nClient.updateWorkflow(existingWorkflow.id, sanitizedWorkflow);
        updated.push({
          name: workflow.name,
          id: existingWorkflow.id,
          displayName,
        });
        console.log(`   ♻️  Updated: ${existingWorkflow.id}\n`);
      } else {
        const id = await n8nClient.importWorkflow(sanitizedWorkflow);
        created.push({ name: workflow.name, id, displayName });
        console.log(`   ✅ Created: ${id}\n`);
      }
    } catch (error) {
      console.error(`   ❌ Failed to import ${workflow.name}:`, error);
      if (error instanceof Error) {
        console.error(`   Error: ${error.message}\n`);
      }
    }
  }

  console.log('\n📋 Import Summary:');
  console.log('─────────────────');
  if (created.length > 0) {
    created.forEach(({ name, id, displayName }) => {
      console.log(`${displayName} (${name}): created ${id}`);
    });
  }
  if (updated.length > 0) {
    updated.forEach(({ name, id, displayName }) => {
      console.log(`${displayName} (${name}): updated ${id}`);
    });
  }

  const processed = [...created, ...updated];

  if (processed.length > 0) {
    console.log(
      '\n💡 Update agent.workflow.json toolWorkflow nodes with these IDs'
    );
    console.log('\n💡 Export these IDs as environment variables for seeding:');
    processed.forEach(({ displayName, id }) => {
      const envVar = `N8N_WORKFLOW_ID_${displayName.toUpperCase().replace(/\s+/g, '_')}`;
      console.log(`   export ${envVar}=${id}`);
    });
  }
}

importWorkflows().catch((error) => {
  console.error('Failed to import workflows:', error);
  process.exit(1);
});
