import { db } from '../client.js';
import { agentWebhooks } from '../schema.js';
import { eq } from 'drizzle-orm';

export interface CreateAgentWebhookParams {
  agentName: string;
  webhookPath: string;
  method?: string;
  authType?: 'none' | 'header' | 'basic' | 'bearer';
  authConfig?: Record<string, unknown>;
  description?: string;
  isActive?: boolean;
  timeoutMs?: number;
  metadata?: Record<string, unknown>;
}

export interface AgentWebhook {
  id: string;
  agentName: string;
  webhookPath: string;
  method: string;
  authType: string;
  authConfig: Record<string, unknown>;
  description: string | null;
  isActive: boolean;
  timeoutMs: number | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export class AgentWebhookRepository {
  async findByAgentName(agentName: string): Promise<AgentWebhook | null> {
    const [result] = await db
      .select()
      .from(agentWebhooks)
      .where(eq(agentWebhooks.agentName, agentName))
      .limit(1);

    return (result as AgentWebhook) || null;
  }

  async findActiveAgents(): Promise<AgentWebhook[]> {
    const results = await db
      .select()
      .from(agentWebhooks)
      .where(eq(agentWebhooks.isActive, true));

    return results as AgentWebhook[];
  }

  async create(params: CreateAgentWebhookParams): Promise<AgentWebhook> {
    const [result] = await db
      .insert(agentWebhooks)
      .values({
        agentName: params.agentName,
        webhookPath: params.webhookPath,
        method: params.method || 'POST',
        authType: params.authType || 'none',
        authConfig: params.authConfig || {},
        description: params.description || null,
        isActive: params.isActive !== undefined ? params.isActive : true,
        timeoutMs: params.timeoutMs || null,
        metadata: params.metadata || {},
      })
      .returning();

    return result as AgentWebhook;
  }

  async updateActive(agentName: string, isActive: boolean): Promise<AgentWebhook | null> {
    const [result] = await db
      .update(agentWebhooks)
      .set({
        isActive,
        updatedAt: new Date(),
      })
      .where(eq(agentWebhooks.agentName, agentName))
      .returning();

    return (result as AgentWebhook) || null;
  }
}

