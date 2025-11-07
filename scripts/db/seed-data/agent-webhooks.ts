import { db } from '../../../src/db/client.js';
import { agentWebhooks } from '../../../src/db/schema.js';
import { eq } from 'drizzle-orm';

export interface AgentWebhookSeed {
  agentName: string;
  webhookPath: string;
  method?: string;
  authType?: 'none' | 'header' | 'basic' | 'bearer';
  authConfig?: Record<string, unknown>;
  description: string;
  isActive?: boolean;
  timeoutMs?: number;
  metadata?: Record<string, unknown>;
}

export const agentWebhookSeeds: AgentWebhookSeed[] = [
  {
    agentName: 'casey',
    webhookPath: '/webhook/casey/ingest',
    method: 'POST',
    authType: 'none',
    description: 'Casey orchestrator agent webhook',
    isActive: true,
    timeoutMs: 30000,
    metadata: {
      persona: 'casey',
      downstreamAgent: 'iggy',
      workflowFile: 'workflows/casey.workflow.json',
      workflowIdEnv: 'N8N_WORKFLOW_ID_CASEY',
      callWorkflowTool: "Call 'Iggy Workflow'",
    },
  },
  {
    agentName: 'iggy',
    webhookPath: '/webhook/iggy/ingest',
    method: 'POST',
    authType: 'none',
    description: 'Iggy ideation agent webhook',
    isActive: true,
    timeoutMs: 30000,
    metadata: {
      persona: 'iggy',
      workflowIdEnv: 'N8N_WORKFLOW_ID_IGGY',
      expects: ['traceId', 'projectId', 'sessionId', 'instructions'],
    },
  },
  {
    agentName: 'riley',
    webhookPath: '/webhook/riley/ingest',
    method: 'POST',
    authType: 'none',
    description: 'Riley screenwriter agent webhook',
    isActive: true,
    timeoutMs: 30000,
  },
  {
    agentName: 'veo',
    webhookPath: '/webhook/veo/ingest',
    method: 'POST',
    authType: 'none',
    description: 'Veo video generation agent webhook',
    isActive: true,
    timeoutMs: 60000, // Longer timeout for video generation
  },
  {
    agentName: 'alex',
    webhookPath: '/webhook/alex/ingest',
    method: 'POST',
    authType: 'none',
    description: 'Alex video editor agent webhook',
    isActive: true,
    timeoutMs: 60000, // Longer timeout for video editing
  },
  {
    agentName: 'quinn',
    webhookPath: '/webhook/quinn/ingest',
    method: 'POST',
    authType: 'none',
    description: 'Quinn publisher agent webhook',
    isActive: true,
    timeoutMs: 30000,
  },
];

export async function seedAgentWebhooks() {
  console.log('🌱 Seeding agent webhooks...');

  for (const seed of agentWebhookSeeds) {
    const existing = await db
      .select()
      .from(agentWebhooks)
      .where(eq(agentWebhooks.agentName, seed.agentName))
      .limit(1);

    if (existing.length > 0) {
      console.log(`   ⏭️  Skipping ${seed.agentName} (already exists)`);
      continue;
    }

    await db.insert(agentWebhooks).values({
      agentName: seed.agentName,
      webhookPath: seed.webhookPath,
      method: seed.method || 'POST',
      authType: seed.authType || 'none',
      authConfig: seed.authConfig || {},
      description: seed.description,
      isActive: seed.isActive !== undefined ? seed.isActive : true,
      timeoutMs: seed.timeoutMs,
      metadata: seed.metadata || {},
    });

    console.log(`   ✅ Seeded ${seed.agentName}`);
  }

  console.log('✅ Agent webhooks seeded');
}
