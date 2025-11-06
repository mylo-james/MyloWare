import { db } from '../client.js';
import { handoffTasks } from '../schema.js';
import { eq, and, sql } from 'drizzle-orm';

export interface CreateHandoffParams {
  runId: string;
  fromPersona?: string;
  toPersona: string;
  taskBrief?: string;
  requiredOutputs?: Record<string, unknown>;
}

export interface CompleteHandoffParams {
  status: 'done' | 'returned';
  outputs?: Record<string, unknown>;
  notes?: string;
}

export class HandoffRepository {
  async create(params: CreateHandoffParams) {
    const [handoff] = await db
      .insert(handoffTasks)
      .values({
        ...params,
        status: 'pending',
        metadata: {},
      })
      .returning();
    return handoff;
  }

  async findById(id: string) {
    const [handoff] = await db
      .select()
      .from(handoffTasks)
      .where(eq(handoffTasks.id, id));
    return handoff;
  }

  async listPending(runId?: string, persona?: string) {
    const conditions = [eq(handoffTasks.status, 'pending')];
    if (runId) conditions.push(eq(handoffTasks.runId, runId));
    if (persona) conditions.push(eq(handoffTasks.toPersona, persona));

    return db
      .select()
      .from(handoffTasks)
      .where(and(...conditions))
      .orderBy(handoffTasks.createdAt);
  }

  async claim(id: string, agentId: string, ttlMs: number) {
    const now = new Date();
    const lockExpiry = new Date(now.getTime() - ttlMs);

    const [handoff] = await db
      .update(handoffTasks)
      .set({
        custodianAgent: agentId,
        lockedAt: now,
        status: 'in_progress',
        updatedAt: now,
      })
      .where(
        and(
          eq(handoffTasks.id, id),
          eq(handoffTasks.status, 'pending'),
          sql`(${handoffTasks.lockedAt} IS NULL OR ${handoffTasks.lockedAt} < ${lockExpiry})`
        )
      )
      .returning();

    return handoff ? { status: 'locked', handoff } : { status: 'conflict' };
  }

  async complete(id: string, params: CompleteHandoffParams) {
    const metadata = params.outputs || params.notes
      ? { outputs: params.outputs, notes: params.notes }
      : {};

    const [handoff] = await db
      .update(handoffTasks)
      .set({
        status: params.status,
        completedAt: new Date(),
        metadata,
        updatedAt: new Date(),
      })
      .where(eq(handoffTasks.id, id))
      .returning();
    return handoff;
  }
}

