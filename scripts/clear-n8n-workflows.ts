#!/usr/bin/env tsx

import { config } from '../src/config/index.js';
import { N8nClient } from '../src/integrations/n8n/client.js';

async function main() {
  const baseUrl = config.n8n.baseUrl || 'http://localhost:5678';
  const apiKey = config.n8n.apiKey;

  if (!apiKey) {
    throw new Error('N8N_API_KEY is required to manage workflows.');
  }

  const client = new N8nClient({ baseUrl, apiKey });

  console.log(`🔍 Fetching workflows from ${baseUrl}...`);
  const workflows = await client.listWorkflows(250);

  if (workflows.length === 0) {
    console.log('✅ No workflows found.');
    return;
  }

  console.log(`🗑️ Deleting ${workflows.length} workflow(s):`);
  for (const workflow of workflows) {
    console.log(`   - ${workflow.name} (${workflow.id})`);
    await client.deleteWorkflow(workflow.id);
  }

  console.log('✅ All workflows deleted.');
}

main().catch((error) => {
  console.error('Failed to clear workflows:', error);
  process.exit(1);
});

