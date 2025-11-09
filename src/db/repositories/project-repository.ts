import { db } from '../client.js';
import { projects } from '../schema.js';
import { eq, ilike, or } from 'drizzle-orm';

export interface Project {
  id: string;
  name: string;
  description: string;
  workflow: string[];
  optionalSteps: string[];
  guardrails: Record<string, unknown>;
  settings: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export class ProjectRepository {
  /**
   * Validates that optionalSteps is a subset of workflow
   */
  private validateOptionalSteps(workflow: string[], optionalSteps: string[]): void {
    const workflowSet = new Set(workflow);
    const invalidSteps = optionalSteps.filter(step => !workflowSet.has(step));
    if (invalidSteps.length > 0) {
      throw new Error(
        `optionalSteps must be a subset of workflow. Invalid steps: ${invalidSteps.join(', ')}`
      );
    }
  }

  async findByName(name: string): Promise<Project | null> {
    const [result] = await db
      .select()
      .from(projects)
      .where(eq(projects.name, name))
      .limit(1);

    return (result as Project) || null;
  }

  async findById(id: string): Promise<Project | null> {
    const [result] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, id))
      .limit(1);

    return (result as Project) || null;
  }

  async findAll(): Promise<Project[]> {
    const results = await db.select().from(projects);

    return results as Project[];
  }

  async listAllNames(): Promise<string[]> {
    const results = await db
      .select({ name: projects.name })
      .from(projects);

    return results.map((r) => r.name);
  }

  async search(term: string, limit = 5): Promise<Project[]> {
    const normalized = term.trim();
    if (!normalized) {
      return [];
    }

    const pattern = `%${normalized.replace(/[%_]/g, '\\$&')}%`;

    const results = await db
      .select()
      .from(projects)
      .where(
        or(
          ilike(projects.name, pattern),
          ilike(projects.description, pattern)
        )
      )
      .limit(Math.max(1, Math.min(limit, 20)));

    return results as Project[];
  }

  async insert(project: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>): Promise<Project> {
    // Validate optionalSteps is a subset of workflow
    this.validateOptionalSteps(project.workflow, project.optionalSteps);

    const [result] = await db
      .insert(projects)
      .values(project)
      .returning();

    return result as Project;
  }
}

