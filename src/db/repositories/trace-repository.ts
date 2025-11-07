import { db } from '../client.js';
import { executionTraces } from '../schema.js';
import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'crypto';

export interface CreateTraceParams {
  projectId: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

export interface Trace {
  id: string;
  traceId: string;
  projectId: string;
  sessionId: string | null;
  status: string;
  outputs: Record<string, unknown> | null;
  createdAt: Date;
  completedAt: Date | null;
  metadata: Record<string, unknown>;
}

export class TraceRepository {
  async create(params: CreateTraceParams): Promise<Trace> {
    const traceId = randomUUID();
    const [result] = await db
      .insert(executionTraces)
      .values({
        traceId,
        projectId: params.projectId,
        sessionId: params.sessionId || null,
        status: 'active',
        metadata: params.metadata || {},
      })
      .returning();

    return result as Trace;
  }

  async findByTraceId(traceId: string): Promise<Trace | null> {
    const [result] = await db
      .select()
      .from(executionTraces)
      .where(eq(executionTraces.traceId, traceId))
      .limit(1);

    return (result as Trace) || null;
  }

  async updateStatus(
    traceId: string,
    status: 'completed' | 'failed',
    outputs?: Record<string, unknown>
  ): Promise<Trace | null> {
    const updateData: Record<string, unknown> = {
      status,
      completedAt: new Date(),
    };

    if (outputs !== undefined) {
      updateData.outputs = outputs;
    }

    const [result] = await db
      .update(executionTraces)
      .set(updateData)
      .where(eq(executionTraces.traceId, traceId))
      .returning();

    return (result as Trace) || null;
  }

  async findActiveTraces(projectId?: string): Promise<Trace[]> {
    const conditions = [eq(executionTraces.status, 'active')];
    
    if (projectId) {
      conditions.push(eq(executionTraces.projectId, projectId));
    }

    const results = await db
      .select()
      .from(executionTraces)
      .where(and(...conditions));

    return results as Trace[];
  }
}

