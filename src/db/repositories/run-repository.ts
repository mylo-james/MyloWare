import { db } from '../client.js';
import { agentRuns } from '../schema.js';
import { eq, and, sql } from 'drizzle-orm';

export interface CreateRunParams {
  sessionId?: string;
  persona: string;
  project: string;
  instructions?: string;
}

export interface UpdateRunParams {
  currentStep?: string;
  status?: string;
  stateBlob?: Record<string, unknown>;
  custodianAgent?: string | null;
  lockedAt?: Date | null;
}

export class RunRepository {
  async create(params: CreateRunParams) {
    const values: typeof agentRuns.$inferInsert = {
      persona: params.persona,
      project: params.project,
      status: 'new',
      stateBlob: {},
      ...(params.sessionId && { sessionId: params.sessionId }),
      ...(params.instructions && { instructions: params.instructions }),
    };

    const [run] = await db.insert(agentRuns).values(values).returning();
    return run;
  }

  async findById(id: string) {
    const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, id));
    return run;
  }

  async update(id: string, patch: UpdateRunParams) {
    const [run] = await db
      .update(agentRuns)
      .set({
        ...patch,
        updatedAt: new Date(),
      })
      .where(eq(agentRuns.id, id))
      .returning();
    return run;
  }

  async findOrCreateForSession(
    sessionId: string,
    persona: string,
    project: string,
    instructions?: string
  ) {
    // Try to find an active run for this session
    const [existing] = await db
      .select()
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.sessionId, sessionId),
          eq(agentRuns.persona, persona),
          eq(agentRuns.project, project)
        )
      )
      .orderBy(sql`${agentRuns.createdAt} DESC`)
      .limit(1);

    if (
      existing &&
      existing.status !== 'completed' &&
      existing.status !== 'failed'
    ) {
      return existing;
    }

    // Create new run
    return this.create({ sessionId, persona, project, instructions });
  }

  // Lease support: claim a run for a given TTL
  async claim(id: string, agentId: string, ttlMs: number) {
    const now = new Date();
    const lockExpiry = new Date(now.getTime() - ttlMs);

    // Update only if not locked or lock expired
    const [run] = await db
      .update(agentRuns)
      .set({
        custodianAgent: agentId,
        lockedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(agentRuns.id, id),
          sql`(${agentRuns.lockedAt} IS NULL OR ${agentRuns.lockedAt} < ${lockExpiry})`
        )
      )
      .returning();

    return run ? { status: 'locked', run } : { status: 'conflict' };
  }
}
