#!/usr/bin/env tsx
import { N8nClient } from '../../src/integrations/n8n/client.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from '../../src/config/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

type WorkflowNode = {
  type?: string;
  parameters?: Record<string, unknown>;
  credentials?: Record<string, { name?: string; id?: string }>;
  [key: string]: unknown;
};

type WorkflowFile = {
  name?: string;
  nodes?: WorkflowNode[];
  connections?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  [key: string]: unknown;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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

  // Detect if we're importing to localhost (dev/test)
  const isLocalhost = config.n8n.baseUrl?.includes('localhost') || config.n8n.baseUrl?.includes('127.0.0.1');
  
  console.log(`   Target: ${config.n8n.baseUrl}`);
  console.log(`   Mode: ${isLocalhost ? 'LOCAL (URLs will be rewritten)' : 'CLOUD'}\n`);

  const workflows = [
    {
      name: 'myloware-agent.workflow.json',
      path: join(__dirname, '../../workflows/myloware-agent.workflow.json'),
    },
    {
      name: 'edit-aismr.workflow.json',
      path: join(__dirname, '../../workflows/edit-aismr.workflow.json'),
    },
    {
      name: 'generate-video.workflow.json',
      path: join(__dirname, '../../workflows/generate-video.workflow.json'),
    },
    {
      name: 'upload-file-to-google-drive.workflow.json',
      path: join(
        __dirname,
        '../../workflows/upload-file-to-google-drive.workflow.json'
      ),
    },
    {
      name: 'upload-to-tiktok.workflow.json',
      path: join(__dirname, '../../workflows/upload-to-tiktok.workflow.json'),
    },
    {
      name: 'mcp-health-check.workflow.json',
      path: join(__dirname, '../../workflows/mcp-health-check.workflow.json'),
    },
    {
      name: 'error-handler.workflow.json',
      path: join(__dirname, '../../workflows/error-handler.workflow.json'),
    },
  ];

  const existing = await n8nClient.listWorkflows(250);
  const existingByName = new Map(existing.map((wf) => [wf.name, wf]));

  // For localhost, also fetch credentials to match by name
  let credentialsByName = new Map<string, string>();
  if (isLocalhost) {
    try {
      const response = await fetch(`${config.n8n.baseUrl}/api/v1/credentials`, {
        headers: {
          'X-N8N-API-KEY': config.n8n.apiKey || '',
        },
      });
      if (response.ok) {
        const creds = (await response.json()) as { data?: Array<{ name: string; id: string }> };
        if (Array.isArray(creds.data)) {
          credentialsByName = new Map(creds.data.map((credential) => [credential.name, credential.id]));
          console.log(`   Found ${credentialsByName.size} credentials to match\n`);
        }
      }
    } catch (error) {
      console.log(
        `   ⚠️  Could not fetch credentials, will skip ID matching (${getErrorMessage(error)})\n`,
      );
    }
  }

  const created: Array<{ name: string; id: string; displayName: string }> = [];
  const updated: Array<{ name: string; id: string; displayName: string }> = [];

  for (const workflow of workflows) {
    try {
      console.log(`📥 Importing ${workflow.name}...`);
      const rawWorkflow = JSON.parse(readFileSync(workflow.path, 'utf-8')) as WorkflowFile;

      // Rewrite URLs and remove credentials for localhost environments
      if (isLocalhost && Array.isArray(rawWorkflow.nodes)) {
        rawWorkflow.nodes = rawWorkflow.nodes
          .map((node) => {
            const mutableNode: WorkflowNode = { ...node };

            if (mutableNode.parameters && typeof mutableNode.parameters === 'object') {
            // Replace MCP URLs
              const url = mutableNode.parameters.url;
              if (typeof url === 'string') {
                mutableNode.parameters.url = url.replace(
                  'https://mcp-vector.mjames.dev/mcp',
                  'http://host.docker.internal:3456/mcp',
                );
              }
              const endpointUrl = mutableNode.parameters.endpointUrl;
              if (typeof endpointUrl === 'string') {
                mutableNode.parameters.endpointUrl = endpointUrl.replace(
                  'https://mcp-vector.mjames.dev/mcp',
                  'http://host.docker.internal:3456/mcp',
                );
              }
            }

            // Match credentials by name for localhost
            if (mutableNode.credentials && credentialsByName.size > 0) {
              Object.entries(mutableNode.credentials).forEach(([credType, credential]) => {
                if (!credential) return;
                const credName = credential.name;
                if (credName && credentialsByName.has(credName)) {
                  credential.id = credentialsByName.get(credName);
                } else if (credName) {
                  console.log(`   ⚠️  Credential not found: "${credName}" (type: ${credType})`);
                  delete credential.id;
                }
              });
            }

            // Remove guardrails node for localhost (not available in docker image)
            if (mutableNode.type === '@n8n/n8n-nodes-langchain.guardrails') {
              console.log(`   ⚠️  Skipping guardrails node (not available in local n8n)`);
              return null;
            }

            // Remove Telegram trigger for localhost (requires credentials)
            if (mutableNode.type === 'n8n-nodes-base.telegramTrigger') {
              console.log(`   ⚠️  Skipping Telegram trigger (requires cloud credentials)`);
              return null;
            }

            // Remove Chat trigger for localhost (requires cloud features)
            if (mutableNode.type === '@n8n/n8n-nodes-langchain.chatTrigger') {
              console.log(`   ⚠️  Skipping Chat trigger (requires cloud features)`);
              return null;
            }

            return mutableNode;
          })
          .filter((node): node is WorkflowNode => Boolean(node));
        
        // Fix connections after removing guardrails
        if (rawWorkflow.connections && rawWorkflow.connections['Prepare Trace Context']) {
          // Connect Prepare Trace Context directly to Enforce Tool Guardrails
          rawWorkflow.connections['Prepare Trace Context'] = {
            main: [[{
              node: 'Enforce Tool Guardrails',
              type: 'main',
              index: 0
            }]]
          };
        }
      }

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
      console.error(`   ❌ Failed to import ${workflow.name}:`, getErrorMessage(error));
      console.error();
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
  console.error('Failed to import workflows:', getErrorMessage(error));
  process.exit(1);
});


