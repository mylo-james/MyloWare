#!/usr/bin/env tsx
import { N8nClient } from '../../src/integrations/n8n/client.js';
import { WorkflowMappingRepository } from '../../src/db/repositories/workflow-mapping-repository.js';
import { config } from '../../src/config/index.js';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

type ToolWorkflowNode = {
  type?: string;
  name?: string;
  parameters?: {
    workflowId?: { value?: string };
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type WorkflowJson = {
  nodes?: ToolWorkflowNode[];
  [key: string]: unknown;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function validateWorkflowIds() {
  console.log('🔍 Validating workflow IDs...\n');

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
  let hasErrors = false;

  const mappings = await workflowMappingRepository.listByEnvironment(
    process.env.N8N_ENVIRONMENT || 'production'
  );

  console.log('📋 Checking database mappings...\n');
  for (const mapping of mappings) {
    try {
      const workflow = await n8nClient.getWorkflow(mapping.workflowId);
      if (workflow.name !== mapping.workflowName) {
        console.error(`❌ Name mismatch for ${mapping.workflowKey}:`);
        console.error(`   Database: ${mapping.workflowName}`);
        console.error(`   n8n:      ${workflow.name}`);
        hasErrors = true;
      } else {
        console.log(`✓ ${mapping.workflowKey} → ${mapping.workflowId}`);
      }
    } catch (error) {
      console.error(
        `❌ Workflow not found in n8n: ${mapping.workflowKey} (${mapping.workflowId}) - ${getErrorMessage(error)}`
      );
      hasErrors = true;
    }
  }

  // Check universal workflow JSON
  console.log('\n📋 Checking universal workflow JSON...\n');
  const path = resolve(__dirname, '../../workflows/myloware-agent.workflow.json');
  const workflow = JSON.parse(readFileSync(path, 'utf-8')) as WorkflowJson;

  for (const node of workflow.nodes ?? []) {
    if (node.type === '@n8n/n8n-nodes-langchain.toolWorkflow') {
      const id = node.parameters?.workflowId?.value;
      const nodeName = node.name ?? 'Unknown node';
      if (typeof id !== 'string' || id.length === 0) {
        console.error(`❌ Missing workflow ID in ${nodeName}`);
        hasErrors = true;
        continue;
      }

      try {
        await n8nClient.getWorkflow(id);
        console.log(`✓ ${nodeName} → ${id}`);
      } catch (error) {
        console.error(`❌ Invalid workflow ID in ${nodeName}: ${id} (${getErrorMessage(error)})`);
        hasErrors = true;
      }
    }
  }

  if (hasErrors) {
    console.error('\n❌ Validation failed! Run: npm run sync:n8n-ids');
    process.exit(1);
  } else {
    console.log('\n✅ All workflow IDs are valid!');
  }
}

validateWorkflowIds().catch((error) => {
  console.error('❌ Validation failed:', getErrorMessage(error));
  process.exit(1);
});


