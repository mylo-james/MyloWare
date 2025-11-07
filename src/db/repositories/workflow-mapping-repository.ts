import { eq, and } from 'drizzle-orm';
import { db } from '../client.js';
import { workflowMappings } from '../schema.js';
import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';

export type WorkflowMapping = InferSelectModel<typeof workflowMappings>;
export type NewWorkflowMapping = InferInsertModel<typeof workflowMappings>;

export class WorkflowMappingRepository {
  /**
   * Find workflow mapping by key and environment
   */
  async findByKey(
    workflowKey: string,
    environment: string = 'production'
  ): Promise<WorkflowMapping | null> {
    const [result] = await db
      .select()
      .from(workflowMappings)
      .where(
        and(
          eq(workflowMappings.workflowKey, workflowKey),
          eq(workflowMappings.environment, environment),
          eq(workflowMappings.isActive, true)
        )
      )
      .limit(1);

    return result || null;
  }

  /**
   * Find workflow mapping by ID
   */
  async findById(id: string): Promise<WorkflowMapping | null> {
    const [result] = await db
      .select()
      .from(workflowMappings)
      .where(eq(workflowMappings.id, id))
      .limit(1);

    return result || null;
  }

  /**
   * Create or update workflow mapping
   */
  async upsert(mapping: NewWorkflowMapping): Promise<WorkflowMapping> {
    const existing = await this.findByKey(
      mapping.workflowKey,
      mapping.environment || 'production'
    );

    if (existing) {
      const [updated] = await db
        .update(workflowMappings)
        .set({
          workflowId: mapping.workflowId,
          workflowName: mapping.workflowName,
          description: mapping.description,
          isActive: mapping.isActive ?? true,
          metadata: mapping.metadata ?? {},
          updatedAt: new Date(),
        })
        .where(eq(workflowMappings.id, existing.id))
        .returning();

      return updated;
    }

    const [created] = await db
      .insert(workflowMappings)
      .values({
        ...mapping,
        environment: mapping.environment || 'production',
        isActive: mapping.isActive ?? true,
        metadata: mapping.metadata ?? {},
      })
      .returning();

    return created;
  }

  /**
   * List all workflow mappings for an environment
   */
  async listByEnvironment(
    environment: string = 'production',
    includeInactive: boolean = false
  ): Promise<WorkflowMapping[]> {
    const conditions = [eq(workflowMappings.environment, environment)];
    if (!includeInactive) {
      conditions.push(eq(workflowMappings.isActive, true));
    }

    return await db
      .select()
      .from(workflowMappings)
      .where(and(...conditions))
      .orderBy(workflowMappings.workflowKey);
  }

  /**
   * Deactivate a workflow mapping
   */
  async deactivate(id: string): Promise<void> {
    await db
      .update(workflowMappings)
      .set({
        isActive: false,
        updatedAt: new Date(),
      })
      .where(eq(workflowMappings.id, id));
  }
}

