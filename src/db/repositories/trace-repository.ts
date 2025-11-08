import { db } from '../client.js';
import { executionTraces, sessions } from '../schema.js';
import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { logger } from '../../utils/logger.js';

export interface CreateTraceParams {
  projectId?: string | null; // UUID, not text slug
  sessionId?: string;
  metadata?: Record<string, unknown>;
  instructions?: string;
}

export interface UpdateTraceParams {
  projectId?: string;
  instructions?: string;
  metadata?: Record<string, unknown>;
}

export interface Trace {
  id: string;
  traceId: string;
  projectId: string | null; // UUID when set, null otherwise
  sessionId: string | null;
  currentOwner: string;
  previousOwner: string | null;
  instructions: string;
  workflowStep: number;
  status: string;
  outputs: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  metadata: Record<string, unknown>;
}

export class TraceRepository {
  async create(params: CreateTraceParams): Promise<Trace> {
    const traceId = randomUUID();

    let sessionId: string | null = null;
    if (params.sessionId) {
      try {
        const [existingSession] = await db
          .select({ id: sessions.id })
          .from(sessions)
          .where(eq(sessions.id, params.sessionId))
          .limit(1);
        if (existingSession) {
          sessionId = params.sessionId;
        } else {
          logger.warn({
            msg: 'Session not found, trace will be created without sessionId',
            sessionId: params.sessionId,
            traceId,
          });
        }
      } catch (error) {
        logger.warn({
          msg: 'Failed to validate session for trace creation, ignoring sessionId',
          sessionId: params.sessionId,
          traceId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Build insert values, omitting previousOwner to let DB default to NULL
    // This avoids issues with Drizzle potentially converting null to empty string
    const insertValues = {
      traceId,
      projectId: params.projectId ?? null,
      sessionId,
      currentOwner: 'casey' as const,
      instructions: params.instructions ?? '',
      workflowStep: 0,
      status: 'active' as const,
      metadata: params.metadata || {},
    };

    const [result] = await db
      .insert(executionTraces)
      .values(insertValues)
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

  async getTrace(traceId: string): Promise<Trace | null> {
    return this.findByTraceId(traceId);
  }

  async updateStatus(
    traceId: string,
    status: 'completed' | 'failed',
    outputs?: Record<string, unknown>
  ): Promise<Trace | null> {
    const updateData: Record<string, unknown> = {
      status,
      completedAt: new Date(),
      // updated_at is handled by trigger, don't set manually
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

  async updateWorkflow(
    traceId: string,
    owner: string,
    instructions: string,
    workflowStep: number,
    expectedCurrentOwner?: string
  ): Promise<Trace | null> {
    // Fetch current owner for previousOwner field and optimistic locking check
    const current = await this.findByTraceId(traceId);
    if (!current) return null;

    // Optimistic locking: if expectedCurrentOwner is provided, verify it matches
    if (expectedCurrentOwner !== undefined && current.currentOwner !== expectedCurrentOwner) {
      throw new Error(
        `Trace ownership conflict: expected owner '${expectedCurrentOwner}', but current owner is '${current.currentOwner}'`
      );
    }

    const [result] = await db
      .update(executionTraces)
      .set({
        previousOwner: current.currentOwner,
        currentOwner: owner,
        instructions,
        workflowStep,
      })
      .where(eq(executionTraces.traceId, traceId))
      .returning();

    return (result as Trace) || null;
  }

  async updateTrace(
    traceId: string,
    updates: UpdateTraceParams
  ): Promise<Trace | null> {
    const updateData: Record<string, unknown> = {};

    if (typeof updates.projectId !== 'undefined') {
      updateData.projectId = updates.projectId;
    }
    if (typeof updates.instructions !== 'undefined') {
      updateData.instructions = updates.instructions;
    }
    if (typeof updates.metadata !== 'undefined') {
      updateData.metadata = updates.metadata;
    }

    if (Object.keys(updateData).length === 0) {
      return this.findByTraceId(traceId);
    }

    const [result] = await db
      .update(executionTraces)
      .set(updateData)
      .where(eq(executionTraces.traceId, traceId))
      .returning();

    return (result as Trace) || null;
  }
}
