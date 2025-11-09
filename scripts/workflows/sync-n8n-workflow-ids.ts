#!/usr/bin/env tsx
import { N8nClient } from '../../src/integrations/n8n/client.js';
import { WorkflowMappingRepository } from '../../src/db/repositories/workflow-mapping-repository.js';
import { config } from '../../src/config/index.js';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface WorkflowMapping {
  key: string;
  name: string;
}

const WORKFLOW_MAPPINGS: WorkflowMapping[] = [
  { key: 'upload-google-drive', name: 'Upload file to Google Drive' },
  { key: 'upload-tiktok', name: 'Upload to TikTok' },
  { key: 'shotstack-edit', name: 'Edit_AISMR' },
  { key: 'generate-video', name: 'Generate Video' },
];

async function syncWorkflowIds() {
  console.log('🔄 Fetching workflows from n8n API...\n');

  if (!config.n8n.baseUrl || !config.n8n.apiKey) {
    throw new Error(
      'N8N_BASE_URL and N8N_API_KEY environment variables must be set'
    );
  }

  const n8nClient = new N8nClient({
    baseUrl: config.n8n.baseUrl,
    apiKey: config.n8n.apiKey,
  });

  const workflowMappingRepository = new WorkflowMappingRepository();
  const workflows = await n8nClient.getWorkflows();
  const updates: Array<{ key: string; id: string; name: string }> = [];

  for (const mapping of WORKFLOW_MAPPINGS) {
    const workflow = workflows.find((w) => w.name === mapping.name);

    if (!workflow) {
      console.warn(`⚠️  Workflow not found: ${mapping.name}`);
      continue;
    }

    console.log(`✓ Found ${mapping.name} → ${workflow.id}`);

    await workflowMappingRepository.upsert({
      workflowKey: mapping.key,
      workflowId: workflow.id,
      workflowName: workflow.name,
      environment: process.env.N8N_ENVIRONMENT || 'production',
      isActive: true,
    });

    updates.push({ key: mapping.key, id: workflow.id, name: workflow.name });
  }

  // Update universal workflow JSON
  console.log('\n📝 Updating workflows/myloware-agent.workflow.json...');
  const path = resolve(__dirname, '../../workflows/myloware-agent.workflow.json');
  const workflow = JSON.parse(readFileSync(path, 'utf-8'));

  for (const node of workflow.nodes) {
    if (node.type === '@n8n/n8n-nodes-langchain.toolWorkflow') {
      const nodeName = node.name;
      let mapping = null;

      if (nodeName.includes('Shotstack') || nodeName.includes('Edit')) {
        mapping = updates.find((u) => u.key === 'shotstack-edit');
      } else if (nodeName.includes('Generate Video')) {
        mapping = updates.find((u) => u.key === 'generate-video');
      } else if (nodeName.includes('Google Drive')) {
        mapping = updates.find((u) => u.key === 'upload-google-drive');
      } else if (nodeName.includes('TikTok')) {
        mapping = updates.find((u) => u.key === 'upload-tiktok');
      }

      if (mapping) {
        node.parameters.workflowId.value = mapping.id;
        console.log(`  ✓ Updated ${nodeName} → ${mapping.id}`);
      } else {
        console.warn(`  ⚠️  Could not match node: ${nodeName}`);
      }
    }
  }

  writeFileSync(path, JSON.stringify(workflow, null, 2));
  console.log('\n✅ Sync complete! Re-import universal workflow to n8n.');
}

syncWorkflowIds().catch((error) => {
  console.error('❌ Sync failed:', error);
  process.exit(1);
});


