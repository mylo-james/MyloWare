import { db } from '../client.js';
import { runEvents } from '../schema.js';
import { eq } from 'drizzle-orm';

export interface AppendEventParams {
  runId: string;
  eventType: string;
  actor?: string;
  payload?: Record<string, unknown>;
}

export class RunEventsRepository {
  async append(params: AppendEventParams) {
    const [event] = await db
      .insert(runEvents)
      .values({
        ...params,
        payload: params.payload || {},
      })
      .returning();
    return event;
  }

  async listForRun(runId: string) {
    return db
      .select()
      .from(runEvents)
      .where(eq(runEvents.runId, runId))
      .orderBy(runEvents.createdAt);
  }
}

