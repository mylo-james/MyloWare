import { db } from '../client.js';
import { projects } from '../schema.js';
import { eq } from 'drizzle-orm';

export interface Project {
  id: string;
  name: string;
  description: string;
  workflows: string[];
  guardrails: Record<string, unknown>;
  settings: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export class ProjectRepository {
  async findByName(name: string): Promise<Project | null> {
    const [result] = await db
      .select()
      .from(projects)
      .where(eq(projects.name, name))
      .limit(1);

    return (result as Project) || null;
  }

  async findAll(): Promise<Project[]> {
    const results = await db
      .select()
      .from(projects);

    return results as Project[];
  }

  async insert(project: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>): Promise<Project> {
    const [result] = await db
      .insert(projects)
      .values(project)
      .returning();

    return result as Project;
  }
}

