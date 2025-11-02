import { and, desc, eq, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { getOperationsDb } from './client';
import * as schema from './schema';
import type {
  NewWorkflowRun,
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowStage,
} from './schema';

export interface CreateWorkflowRunData {
  id?: string;
  projectId: string;
  sessionId: string;
  input?: Record<string, unknown>;
  workflowDefinitionChunkId?: string | null;
}

export interface UpdateWorkflowRunData {
  status?: WorkflowRunStatus;
  currentStage?: WorkflowStage;
  stages?: Record<string, { status: string; output?: unknown; error?: string }>;
  output?: unknown;
  workflowDefinitionChunkId?: string | null;
}

export interface WorkflowRunFilters {
  status?: WorkflowRunStatus[];
  projectId?: string;
  currentStage?: WorkflowStage;
  sessionId?: string;
}

export class WorkflowRunRepository {
  constructor(
    private readonly db: NodePgDatabase<typeof schema> = getOperationsDb(),
  ) {}

  async createWorkflowRun(data: CreateWorkflowRunData): Promise<WorkflowRun> {
    const timestamp = new Date().toISOString();

    const defaultStages = {
      idea_generation: { status: 'pending' },
      screenplay: { status: 'pending' },
      video_generation: { status: 'pending' },
      publishing: { status: 'pending' },
    };

    const values: NewWorkflowRun = {
      id: data.id,
      projectId: data.projectId,
      sessionId: data.sessionId,
      currentStage: 'idea_generation',
      status: 'running',
      stages: defaultStages as NewWorkflowRun['stages'],
      input: (data.input ?? {}) as NewWorkflowRun['input'],
      output: null,
      workflowDefinitionChunkId: (data.workflowDefinitionChunkId ??
        null) as NewWorkflowRun['workflowDefinitionChunkId'],
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const [row] = await this.db.insert(schema.workflowRuns).values(values).returning();
    return row;
  }

  async getWorkflowRunById(id: string): Promise<WorkflowRun | null> {
    const [row] = await this.db
      .select()
      .from(schema.workflowRuns)
      .where(eq(schema.workflowRuns.id, id))
      .limit(1);

    return row ?? null;
  }

  async updateWorkflowRun(
    id: string,
    updates: UpdateWorkflowRunData,
  ): Promise<WorkflowRun> {
    const timestamp = new Date().toISOString();

    const updateValues: Partial<NewWorkflowRun> = {
      updatedAt: timestamp,
    };

    if (updates.status !== undefined) {
      updateValues.status = updates.status;
    }

    if (updates.currentStage !== undefined) {
      updateValues.currentStage = updates.currentStage;
    }

    if (updates.stages !== undefined) {
      updateValues.stages = updates.stages as NewWorkflowRun['stages'];
    }

    if (updates.output !== undefined) {
      updateValues.output = updates.output as NewWorkflowRun['output'];
    }

    if (updates.workflowDefinitionChunkId !== undefined) {
      updateValues.workflowDefinitionChunkId = updates.workflowDefinitionChunkId;
    }

    const [row] = await this.db
      .update(schema.workflowRuns)
      .set(updateValues)
      .where(eq(schema.workflowRuns.id, id))
      .returning();

    if (!row) {
      throw new Error(`Workflow run with id ${id} not found`);
    }

    return row;
  }

  async transitionStage(
    runId: string,
    fromStage: WorkflowStage,
    toStage: WorkflowStage,
    output: unknown,
  ): Promise<void> {
    const workflowRun = await this.getWorkflowRunById(runId);

    if (!workflowRun) {
      throw new Error(`Workflow run with id ${runId} not found`);
    }

    const currentStages = workflowRun.stages as Record<
      string,
      { status: string; output?: unknown; error?: string }
    >;

    // Update fromStage
    currentStages[fromStage] = {
      ...currentStages[fromStage],
      status: 'completed',
      output,
    };

    // Update toStage
    currentStages[toStage] = {
      ...currentStages[toStage],
      status: 'in_progress',
    };

    await this.updateWorkflowRun(runId, {
      currentStage: toStage,
      stages: currentStages,
    });
  }

  async listWorkflowRuns(filters: WorkflowRunFilters = {}): Promise<WorkflowRun[]> {
    const conditions = [];

    if (filters.status && filters.status.length > 0) {
      conditions.push(inArray(schema.workflowRuns.status, filters.status));
    }

    if (filters.projectId) {
      conditions.push(eq(schema.workflowRuns.projectId, filters.projectId));
    }

    if (filters.currentStage) {
      conditions.push(eq(schema.workflowRuns.currentStage, filters.currentStage));
    }

    if (filters.sessionId) {
      conditions.push(eq(schema.workflowRuns.sessionId, filters.sessionId));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await this.db
      .select()
      .from(schema.workflowRuns)
      .where(whereClause)
      .orderBy(desc(schema.workflowRuns.createdAt));

    return rows;
  }
}

