import { db } from '../client.js';
import { workflowRegistry } from '../schema.js';
import { eq, and } from 'drizzle-orm';

export interface WorkflowRegistryEntry {
  id: string;
  memoryId: string;
  n8nWorkflowId: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class WorkflowRegistryRepository {
  /**
   * Find n8n workflow ID by memory ID
   */
  async findByMemoryId(memoryId: string): Promise<WorkflowRegistryEntry | null> {
    const [result] = await db
      .select()
      .from(workflowRegistry)
      .where(
        and(
          eq(workflowRegistry.memoryId, memoryId),
          eq(workflowRegistry.isActive, true)
        )
      )
      .limit(1);

    return (result as WorkflowRegistryEntry) || null;
  }

  /**
   * Find memory ID by n8n workflow ID
   */
  async findByN8nWorkflowId(
    n8nWorkflowId: string
  ): Promise<WorkflowRegistryEntry | null> {
    const [result] = await db
      .select()
      .from(workflowRegistry)
      .where(
        and(
          eq(workflowRegistry.n8nWorkflowId, n8nWorkflowId),
          eq(workflowRegistry.isActive, true)
        )
      )
      .limit(1);

    return (result as WorkflowRegistryEntry) || null;
  }

  /**
   * Create a new registry entry
   */
  async create(entry: {
    memoryId: string;
    n8nWorkflowId: string;
    name: string;
    isActive?: boolean;
  }): Promise<WorkflowRegistryEntry> {
    const [result] = await db
      .insert(workflowRegistry)
      .values({
        memoryId: entry.memoryId,
        n8nWorkflowId: entry.n8nWorkflowId,
        name: entry.name,
        isActive: entry.isActive ?? true,
      })
      .returning();

    return result as WorkflowRegistryEntry;
  }

  /**
   * Update an existing registry entry
   */
  async update(
    id: string,
    updates: {
      n8nWorkflowId?: string;
      name?: string;
      isActive?: boolean;
    }
  ): Promise<WorkflowRegistryEntry> {
    const [result] = await db
      .update(workflowRegistry)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(workflowRegistry.id, id))
      .returning();

    return result as WorkflowRegistryEntry;
  }

  /**
   * Deactivate a registry entry (soft delete)
   */
  async deactivate(id: string): Promise<void> {
    await db
      .update(workflowRegistry)
      .set({
        isActive: false,
        updatedAt: new Date(),
      })
      .where(eq(workflowRegistry.id, id));
  }

  /**
   * Find all active workflows for a memory ID (in case of multiple versions)
   */
  async findAllByMemoryId(memoryId: string): Promise<WorkflowRegistryEntry[]> {
    const results = await db
      .select()
      .from(workflowRegistry)
      .where(
        and(
          eq(workflowRegistry.memoryId, memoryId),
          eq(workflowRegistry.isActive, true)
        )
      );

    return results as WorkflowRegistryEntry[];
  }
}

