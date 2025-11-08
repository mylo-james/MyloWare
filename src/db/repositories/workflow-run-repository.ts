import { db } from '../client.js';
import { workflowRuns } from '../schema.js';
import { eq, desc } from 'drizzle-orm';

export type WorkflowRun = typeof workflowRuns.$inferSelect;
type WorkflowRunInsert = typeof workflowRuns.$inferInsert;
type WorkflowRunStatus = WorkflowRun['status'];

export class WorkflowRunRepository {
  async create(run: {
    sessionId?: string;
    workflowName: string;
    input?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }): Promise<WorkflowRun> {
    const insertValues: WorkflowRunInsert = {
      sessionId: run.sessionId ?? null,
      workflowName: run.workflowName,
      status: 'running',
      input: run.input ?? null,
      output: null,
      error: null,
      completedAt: null,
      metadata: run.metadata ?? {},
    };

    const [result] = await db.insert(workflowRuns).values(insertValues).returning();

    return result as WorkflowRun;
  }

  async updateStatus(
    id: string,
    status: WorkflowRunStatus,
    updates?: {
      output?: Record<string, unknown>;
      error?: string;
    }
  ): Promise<WorkflowRun> {
    const setValues: Partial<WorkflowRunInsert> = {
      status,
    };

    if (updates?.output) {
      setValues.output = updates.output;
    }
    if (typeof updates?.error === 'string') {
      setValues.error = updates.error;
    }

    if (status === 'completed' || status === 'failed' || status === 'canceled') {
      setValues.completedAt = new Date();
    }

    const [result] = await db
      .update(workflowRuns)
      .set(setValues)
      .where(eq(workflowRuns.id, id))
      .returning();

    return result as WorkflowRun;
  }

  async findById(id: string): Promise<WorkflowRun | null> {
    const [result] = await db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.id, id))
      .limit(1);

    return (result as WorkflowRun) || null;
  }

  async findBySessionId(sessionId: string): Promise<WorkflowRun[]> {
    const results = await db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.sessionId, sessionId))
      .orderBy(desc(workflowRuns.createdAt));

    return results as WorkflowRun[];
  }

  async findRecent(limit = 10): Promise<WorkflowRun[]> {
    const results = await db
      .select()
      .from(workflowRuns)
      .orderBy(desc(workflowRuns.createdAt))
      .limit(limit);

    return results as WorkflowRun[];
  }

  async update(
    id: string,
    updates: {
      status?: WorkflowRunStatus;
      output?: Record<string, unknown>;
      error?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<WorkflowRun> {
    const setValues: Partial<WorkflowRunInsert> = {
      ...updates,
    };

    if (updates.status === 'completed' || updates.status === 'failed' || updates.status === 'canceled') {
      setValues.completedAt = new Date();
    }

    const [result] = await db
      .update(workflowRuns)
      .set(setValues)
      .where(eq(workflowRuns.id, id))
      .returning();

    return result as WorkflowRun;
  }
}

