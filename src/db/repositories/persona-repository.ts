import { db } from '../client.js';
import { personas } from '../schema.js';
import { eq } from 'drizzle-orm';

export interface Persona {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  tone: string;
  defaultProject: string | null;
  systemPrompt: string | null;
  allowedTools: string[];
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export class PersonaRepository {
  async findByName(name: string): Promise<Persona | null> {
    const [result] = await db
      .select()
      .from(personas)
      .where(eq(personas.name, name))
      .limit(1);

    return (result as Persona) || null;
  }

  async findAll(): Promise<Persona[]> {
    const results = await db
      .select()
      .from(personas);

    return results as Persona[];
  }

  async insert(persona: Omit<Persona, 'id' | 'createdAt' | 'updatedAt'>): Promise<Persona> {
    const [result] = await db
      .insert(personas)
      .values(persona)
      .returning();

    return result as Persona;
  }
}

