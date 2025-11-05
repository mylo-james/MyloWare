import { db } from '../client.js';
import { workflowRuns } from '../schema.js';
import { eq, desc } from 'drizzle-orm';

export interface WorkflowRun {
  id: string;
  sessionId: string | null;
  workflowName: string;
  status: string;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  error: string | null;
  startedAt: Date;
  completedAt: Date | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export class WorkflowRunRepository {
  async create(run: {
    sessionId?: string;
    workflowName: string;
    input?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }): Promise<WorkflowRun> {
    const [result] = await db
      .insert(workflowRuns)
      .values({
        sessionId: run.sessionId || null,
        workflowName: run.workflowName,
        status: 'pending',
        input: run.input || null,
        output: null,
        error: null,
        completedAt: null,
        metadata: run.metadata || {},
      })
      .returning();

    return result as WorkflowRun;
  }

  async updateStatus(
    id: string,
    status: string,
    updates?: {
      output?: Record<string, unknown>;
      error?: string;
    }
  ): Promise<WorkflowRun> {
    const setValues: any = {
      status,
      ...(updates || {}),
    };

    if (status === 'completed' || status === 'failed') {
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
}

