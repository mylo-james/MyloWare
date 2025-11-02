import { and, desc, eq, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { getOperationsDb } from './client';
import * as schema from './schema';
import type {
  NewHITLApproval,
  HITLApproval,
  HITLApprovalStatus,
  WorkflowStage,
} from './schema';

export interface CreateHITLApprovalData {
  id?: string;
  workflowRunId: string;
  stage: WorkflowStage;
  content: unknown;
}

export interface UpdateHITLApprovalData {
  status?: HITLApprovalStatus;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  feedback?: string | null;
}

export interface HITLFilters {
  status?: HITLApprovalStatus[];
  stage?: WorkflowStage;
  projectId?: string;
  workflowRunId?: string;
}

export class HITLRepository {
  constructor(
    private readonly db: NodePgDatabase<typeof schema> = getOperationsDb(),
  ) {}

  async createHITLApproval(data: CreateHITLApprovalData): Promise<HITLApproval> {
    const values: NewHITLApproval = {
      id: data.id,
      workflowRunId: data.workflowRunId,
      stage: data.stage,
      content: data.content as NewHITLApproval['content'],
      status: 'pending',
      reviewedBy: null,
      reviewedAt: null,
      feedback: null,
    };

    const [row] = await this.db.insert(schema.hitlApprovals).values(values).returning();
    return row;
  }

  async getHITLApproval(id: string): Promise<HITLApproval | null> {
    const [row] = await this.db
      .select()
      .from(schema.hitlApprovals)
      .where(eq(schema.hitlApprovals.id, id))
      .limit(1);

    return row ?? null;
  }

  async updateHITLApproval(
    id: string,
    updates: UpdateHITLApprovalData,
  ): Promise<HITLApproval> {
    const updateValues: Partial<NewHITLApproval> = {};

    if (updates.status !== undefined) {
      updateValues.status = updates.status;
    }

    if (updates.reviewedBy !== undefined) {
      updateValues.reviewedBy = updates.reviewedBy;
    }

    if (updates.reviewedAt !== undefined) {
      updateValues.reviewedAt = updates.reviewedAt;
    }

    if (updates.feedback !== undefined) {
      updateValues.feedback = updates.feedback;
    }

    const [row] = await this.db
      .update(schema.hitlApprovals)
      .set(updateValues)
      .where(eq(schema.hitlApprovals.id, id))
      .returning();

    if (!row) {
      throw new Error(`HITL approval with id ${id} not found`);
    }

    return row;
  }

  async getPendingApprovals(filters: HITLFilters = {}): Promise<HITLApproval[]> {
    const conditions = [eq(schema.hitlApprovals.status, 'pending')];

    if (filters.stage) {
      conditions.push(eq(schema.hitlApprovals.stage, filters.stage));
    }

    if (filters.workflowRunId) {
      conditions.push(eq(schema.hitlApprovals.workflowRunId, filters.workflowRunId));
    }

    // If projectId is provided, we need to join with workflow_runs
    if (filters.projectId) {
      const rows = await this.db
        .select({
          id: schema.hitlApprovals.id,
          workflowRunId: schema.hitlApprovals.workflowRunId,
          stage: schema.hitlApprovals.stage,
          content: schema.hitlApprovals.content,
          status: schema.hitlApprovals.status,
          reviewedBy: schema.hitlApprovals.reviewedBy,
          reviewedAt: schema.hitlApprovals.reviewedAt,
          feedback: schema.hitlApprovals.feedback,
          createdAt: schema.hitlApprovals.createdAt,
        })
        .from(schema.hitlApprovals)
        .innerJoin(
          schema.workflowRuns,
          eq(schema.hitlApprovals.workflowRunId, schema.workflowRuns.id),
        )
        .where(
          and(
            eq(schema.hitlApprovals.status, 'pending'),
            eq(schema.workflowRuns.projectId, filters.projectId),
            ...(filters.stage ? [eq(schema.hitlApprovals.stage, filters.stage)] : []),
            ...(filters.workflowRunId
              ? [eq(schema.hitlApprovals.workflowRunId, filters.workflowRunId)]
              : []),
          ),
        )
        .orderBy(desc(schema.hitlApprovals.createdAt));

      return rows as HITLApproval[];
    }

    const whereClause = and(...conditions);

    const rows = await this.db
      .select()
      .from(schema.hitlApprovals)
      .where(whereClause)
      .orderBy(desc(schema.hitlApprovals.createdAt));

    return rows;
  }

  async getApprovalsByWorkflowRun(workflowRunId: string): Promise<HITLApproval[]> {
    const rows = await this.db
      .select()
      .from(schema.hitlApprovals)
      .where(eq(schema.hitlApprovals.workflowRunId, workflowRunId))
      .orderBy(desc(schema.hitlApprovals.createdAt));

    return rows;
  }
}

