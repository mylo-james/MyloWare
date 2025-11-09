#!/usr/bin/env tsx
/**
 * workflows-pull.ts
 * Export workflows from n8n → Git
 * 
 * Usage:
 *   npm run workflows:pull:dev   # Export from local dev n8n
 *   npm run workflows:pull:test  # Export from test n8n
 *   npm run workflows:pull       # Export from default (dev)
 */

import { writeFileSync } from 'fs';
import { join } from 'path';

import { config } from '../../src/config/index.js';

const N8N_BASE_URL =
  process.env.N8N_BASE_URL ||
  config.n8n.baseUrl ||
  'http://localhost:5678';
const N8N_API_KEY = process.env.N8N_API_KEY || config.n8n.apiKey;

interface N8nWorkflow {
  id: string;
  name: string;
  active: boolean;
  nodes: unknown[];
  connections: unknown;
  settings: unknown;
  staticData: unknown;
  tags: unknown[];
  pinData: unknown;
  versionId: string;
  createdAt: string;
  updatedAt: string;
}

async function fetchWorkflows(): Promise<N8nWorkflow[]> {
  const headers: Record<string, string> = {
    'Accept': 'application/json',
  };

  if (N8N_API_KEY) {
    headers['X-N8N-API-KEY'] = N8N_API_KEY;
  }

  console.log(`📥 Fetching workflows from ${N8N_BASE_URL}...`);

  const response = await fetch(`${N8N_BASE_URL}/api/v1/workflows`, {
    headers,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch workflows: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.data || [];
}

async function exportWorkflow(workflow: N8nWorkflow): Promise<void> {
  const filename = `${workflow.name.replace(/[^a-z0-9-]/gi, '-').toLowerCase()}.workflow.json`;
  const filepath = join(process.cwd(), 'workflows', filename);

  // Remove n8n-specific metadata that shouldn't be in Git
  const cleanWorkflow = {
    name: workflow.name,
    nodes: workflow.nodes,
    connections: workflow.connections,
    active: workflow.active,
    settings: workflow.settings,
    staticData: workflow.staticData || null,
    tags: workflow.tags || [],
    pinData: workflow.pinData || {},
  };

  writeFileSync(filepath, JSON.stringify(cleanWorkflow, null, 2) + '\n');
  console.log(`  ✅ ${workflow.name} → workflows/${filename}`);
}

async function main() {
  try {
    console.log('🔄 Pulling workflows from n8n to Git\n');

    const workflows = await fetchWorkflows();

    if (workflows.length === 0) {
      console.log('⚠️  No workflows found in n8n');
      return;
    }

    console.log(`Found ${workflows.length} workflow(s)\n`);

    for (const workflow of workflows) {
      await exportWorkflow(workflow);
    }

    console.log(`\n✅ Successfully pulled ${workflows.length} workflow(s) to workflows/`);
    console.log('\n📝 Next steps:');
    console.log('   git diff workflows/         # Review changes');
    console.log('   git add workflows/          # Stage changes');
    console.log('   git commit -m "chore: sync workflows from n8n"');
  } catch (error) {
    console.error('❌ Error pulling workflows:', error);
    process.exit(1);
  }
}

main();


