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

// Universal workflow: All agents use the same webhook path
// The workflow determines which persona to use based on trace.currentOwner via trace_prep
const UNIVERSAL_WEBHOOK_PATH = '/myloware/ingest';

export const agentWebhookSeeds: AgentWebhookSeed[] = [
  {
    agentName: 'casey',
    webhookPath: UNIVERSAL_WEBHOOK_PATH,
    method: 'POST',
    authType: 'none',
    description: 'Casey orchestrator agent webhook (universal workflow)',
    isActive: true,
    timeoutMs: 30000,
    metadata: {
      persona: 'casey',
      workflowFile: 'workflows/myloware-agent.workflow.json',
      universalWorkflow: true,
    },
  },
  {
    agentName: 'iggy',
    webhookPath: UNIVERSAL_WEBHOOK_PATH,
    method: 'POST',
    authType: 'none',
    description: 'Iggy ideation agent webhook (universal workflow)',
    isActive: true,
    timeoutMs: 30000,
    metadata: {
      persona: 'iggy',
      workflowFile: 'workflows/myloware-agent.workflow.json',
      universalWorkflow: true,
    },
  },
  {
    agentName: 'riley',
    webhookPath: UNIVERSAL_WEBHOOK_PATH,
    method: 'POST',
    authType: 'none',
    description: 'Riley screenwriter agent webhook (universal workflow)',
    isActive: true,
    timeoutMs: 30000,
    metadata: {
      persona: 'riley',
      workflowFile: 'workflows/myloware-agent.workflow.json',
      universalWorkflow: true,
    },
  },
  {
    agentName: 'veo',
    webhookPath: UNIVERSAL_WEBHOOK_PATH,
    method: 'POST',
    authType: 'none',
    description: 'Veo video generation agent webhook (universal workflow)',
    isActive: true,
    timeoutMs: 60000, // Longer timeout for video generation
    metadata: {
      persona: 'veo',
      workflowFile: 'workflows/myloware-agent.workflow.json',
      universalWorkflow: true,
    },
  },
  {
    agentName: 'alex',
    webhookPath: UNIVERSAL_WEBHOOK_PATH,
    method: 'POST',
    authType: 'none',
    description: 'Alex video editor agent webhook (universal workflow)',
    isActive: true,
    timeoutMs: 60000, // Longer timeout for video editing
    metadata: {
      persona: 'alex',
      workflowFile: 'workflows/myloware-agent.workflow.json',
      universalWorkflow: true,
    },
  },
  {
    agentName: 'quinn',
    webhookPath: UNIVERSAL_WEBHOOK_PATH,
    method: 'POST',
    authType: 'none',
    description: 'Quinn publisher agent webhook (universal workflow)',
    isActive: true,
    timeoutMs: 30000,
    metadata: {
      persona: 'quinn',
      workflowFile: 'workflows/myloware-agent.workflow.json',
      universalWorkflow: true,
    },
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
      // Update existing webhook to use universal workflow path
      await db
        .update(agentWebhooks)
        .set({
          webhookPath: seed.webhookPath,
          method: seed.method || 'POST',
          authType: seed.authType || 'none',
          authConfig: seed.authConfig || {},
          description: seed.description,
          isActive: seed.isActive !== undefined ? seed.isActive : true,
          timeoutMs: seed.timeoutMs,
          metadata: seed.metadata || {},
          updatedAt: new Date(),
        })
        .where(eq(agentWebhooks.agentName, seed.agentName));

      console.log(`   🔄 Updated ${seed.agentName} → ${seed.webhookPath}`);
    } else {
      // Insert new webhook
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

      console.log(`   ✅ Seeded ${seed.agentName} → ${seed.webhookPath}`);
    }
  }

  console.log('✅ Agent webhooks seeded');
}
