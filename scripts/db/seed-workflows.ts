#!/usr/bin/env tsx
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { storeMemory } from '../../src/tools/memory/storeTool.js';
import { WorkflowRegistryRepository } from '../../src/db/repositories/workflow-registry-repository.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * n8n workflow ID mappings
 * These should be updated after importing workflows into n8n
 * Format: { "workflow-name": "n8n-workflow-id" }
 */
const N8N_WORKFLOW_IDS: Record<string, string> = {
  'Generate Ideas': process.env.N8N_WORKFLOW_ID_IDEAS || '',
  'Write Script': process.env.N8N_WORKFLOW_ID_SCRIPT || '',
  'Make Videos': process.env.N8N_WORKFLOW_ID_VIDEO || '',
  'Post Video': process.env.N8N_WORKFLOW_ID_TIKTOK || '',
  'AISMR Complete Video Production': process.env.N8N_WORKFLOW_ID_COMPLETE || '',
};

interface WorkflowDefinition {
  name: string;
  description: string;
  steps: unknown[];
  output_format?: unknown;
  guardrails?: unknown[];
}

interface WorkflowFile {
  title: string;
  memoryType: 'procedural';
  project: string[];
  persona: string[];
  version: string;
  workflow: WorkflowDefinition;
}

async function seedWorkflows() {
  console.log('🌱 Seeding workflow procedural memories...\n');

  const registryRepository = new WorkflowRegistryRepository();
  const workflowsDir = join(__dirname, '../../data/workflows');

  const workflowFiles = [
    'aismr-idea-generation-workflow.json',
    'aismr-screenplay-workflow.json',
    'aismr-video-generation-workflow.json',
    'aismr-publishing-workflow.json',
  ];

  const seeded: Array<{ name: string; memoryId: string; n8nId?: string }> = [];

  for (const fileName of workflowFiles) {
    try {
      const filePath = join(workflowsDir, fileName);
      console.log(`📥 Processing ${fileName}...`);

      const fileContent = readFileSync(filePath, 'utf-8');
      const workflowData: WorkflowFile = JSON.parse(fileContent);

      // Create content string for procedural memory
      const content = `${workflowData.workflow.name}: ${workflowData.workflow.description}`;

      // Store as procedural memory
      const memory = await storeMemory({
        content,
        memoryType: 'procedural',
        persona: workflowData.persona,
        project: workflowData.project,
        tags: ['workflow', ...workflowData.project],
        metadata: {
          workflow: workflowData.workflow,
          version: workflowData.version,
          sourceFile: fileName,
        },
      });

      console.log(`   ✅ Stored memory: ${memory.id}`);

      // Register in workflow registry if n8n ID is available
      const n8nWorkflowId = N8N_WORKFLOW_IDS[workflowData.workflow.name];
      if (n8nWorkflowId) {
        await registryRepository.create({
          memoryId: memory.id,
          n8nWorkflowId,
          name: workflowData.workflow.name,
          isActive: true,
        });
        console.log(`   ✅ Registered in workflow_registry: ${n8nWorkflowId}`);
        seeded.push({
          name: workflowData.workflow.name,
          memoryId: memory.id,
          n8nId: n8nWorkflowId,
        });
      } else {
        console.log(
          `   ⚠️  No n8n workflow ID found for "${workflowData.workflow.name}"`
        );
        console.log(
          `      Set N8N_WORKFLOW_ID_${workflowData.workflow.name.toUpperCase().replace(/\s+/g, '_')} env var to register`
        );
        seeded.push({
          name: workflowData.workflow.name,
          memoryId: memory.id,
        });
      }
      console.log('');
    } catch (error) {
      console.error(`   ❌ Failed to seed ${fileName}:`, error);
      if (error instanceof Error) {
        console.error(`   Error: ${error.message}\n`);
      }
    }
  }

  // Create AISMR Complete workflow if all sub-workflows are registered
  const allRegistered = seeded.every((w) => w.n8nId);
  if (allRegistered && seeded.length > 0) {
    try {
      console.log('📥 Creating AISMR Complete Video Production workflow...');

      const completeWorkflow: WorkflowDefinition = {
        name: 'AISMR Complete Video Production',
        description:
          'Complete AISMR video production pipeline from idea generation to TikTok upload',
        steps: [
          {
            id: 'generate_ideas',
            type: 'mcp_call',
            description: 'Generate 12 unique AISMR video ideas',
            mcp_call: {
              tool: 'workflow_execute',
              params: {
                workflowId: seeded.find((w) => w.name === 'Generate Ideas')
                  ?.memoryId,
                input: { userInput: '${context.userInput}' },
              },
            },
          },
          {
            id: 'select_idea',
            type: 'mcp_call',
            description: 'Ask user to select an idea',
            mcp_call: {
              tool: 'clarify_ask',
              params: {
                question: 'Which idea would you like to use?',
                options: '${steps.generate_ideas.output.ideas}',
              },
            },
          },
          {
            id: 'write_screenplay',
            type: 'mcp_call',
            description: 'Write screenplay for selected idea',
            mcp_call: {
              tool: 'workflow_execute',
              params: {
                workflowId: seeded.find((w) => w.name === 'Write Script')
                  ?.memoryId,
                input: { idea: '${steps.select_idea.response}' },
              },
            },
          },
          {
            id: 'generate_video',
            type: 'mcp_call',
            description: 'Generate video from screenplay',
            mcp_call: {
              tool: 'workflow_execute',
              params: {
                workflowId: seeded.find((w) => w.name === 'Make Videos')
                  ?.memoryId,
                input: { screenplay: '${steps.write_screenplay.output}' },
              },
            },
          },
          {
            id: 'upload_tiktok',
            type: 'mcp_call',
            description: 'Upload video to TikTok',
            mcp_call: {
              tool: 'workflow_execute',
              params: {
                workflowId: seeded.find((w) => w.name === 'Post Video')
                  ?.memoryId,
                input: { videoUrl: '${steps.generate_video.output.videoUrl}' },
              },
            },
          },
        ],
      };

      const completeContent =
        'AISMR Complete Video Production: Full pipeline from idea generation to TikTok upload';

      const completeMemory = await storeMemory({
        content: completeContent,
        memoryType: 'procedural',
        persona: ['casey'],
        project: ['aismr'],
        tags: ['workflow', 'aismr', 'complete', 'video-production'],
        metadata: {
          workflow: completeWorkflow,
          version: '1.0.0',
          subWorkflows: seeded.map((w) => ({
            name: w.name,
            memoryId: w.memoryId,
          })),
        },
      });

      console.log(`   ✅ Stored complete workflow memory: ${completeMemory.id}`);

      const completeN8nId = N8N_WORKFLOW_IDS['AISMR Complete Video Production'];
      if (completeN8nId) {
        await registryRepository.create({
          memoryId: completeMemory.id,
          n8nWorkflowId: completeN8nId,
          name: completeWorkflow.name,
          isActive: true,
        });
        console.log(`   ✅ Registered complete workflow: ${completeN8nId}`);
      } else {
        console.log(
          `   ⚠️  No n8n workflow ID for complete workflow. Set N8N_WORKFLOW_ID_COMPLETE env var.`
        );
      }
      console.log('');
    } catch (error) {
      console.error('   ❌ Failed to create complete workflow:', error);
      if (error instanceof Error) {
        console.error(`   Error: ${error.message}\n`);
      }
    }
  }

  console.log('\n📋 Seeding Summary:');
  console.log('─────────────────');
  seeded.forEach(({ name, memoryId, n8nId }) => {
    console.log(`${name}:`);
    console.log(`  Memory ID: ${memoryId}`);
    if (n8nId) {
      console.log(`  n8n ID: ${n8nId}`);
    } else {
      console.log(`  n8n ID: (not registered)`);
    }
  });

  console.log('\n💡 To register n8n workflow IDs:');
  console.log('   1. Import workflows into n8n: npm run import:workflows');
  console.log('   2. Copy workflow IDs from output');
  console.log('   3. Set environment variables:');
  console.log('      N8N_WORKFLOW_ID_IDEAS=<id>');
  console.log('      N8N_WORKFLOW_ID_SCRIPT=<id>');
  console.log('      N8N_WORKFLOW_ID_VIDEO=<id>');
  console.log('      N8N_WORKFLOW_ID_TIKTOK=<id>');
  console.log('   4. Re-run this script: npm run db:seed:workflows');
}

seedWorkflows().catch((error) => {
  console.error('Failed to seed workflows:', error);
  process.exit(1);
});

