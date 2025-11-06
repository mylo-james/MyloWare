import { db } from '../client.js';
import { sessions } from '../schema.js';
import { eq } from 'drizzle-orm';

export interface Session {
  id: string;
  userId: string;
  persona: string;
  project: string;
  lastInteractionAt: Date;
  context: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionContext {
  lastIntent?: string;
  lastWorkflowRun?: string;
  recentTopics?: string[];
  preferences?: Record<string, unknown>;
  conversationHistory?: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
  }>;
}

export class SessionRepository {
  async findOrCreate(
    sessionId: string,
    userId: string,
    persona: string,
    project: string
  ): Promise<Session> {
    const [existing] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);

    if (existing) {
      await this.updateLastInteraction(sessionId);
      return existing as Session;
    }

    const [created] = await db
      .insert(sessions)
      .values({
        id: sessionId,
        userId,
        persona,
        project,
        context: {},
        metadata: {},
      })
      .returning();

    return created as Session;
  }

  async updateLastInteraction(sessionId: string): Promise<void> {
    await db
      .update(sessions)
      .set({
        lastInteractionAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(sessions.id, sessionId));
  }

  async findById(sessionId: string): Promise<Session | null> {
    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);

    return (session as Session) || null;
  }

  async getContext(sessionId: string): Promise<SessionContext> {
    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);

    if (!session) {
      return {};
    }

    return (session.context as SessionContext) || {};
  }

  async updateContext(
    sessionId: string,
    context: SessionContext
  ): Promise<void> {
    await db
      .update(sessions)
      .set({
        context: context as any,
        updatedAt: new Date(),
      })
      .where(eq(sessions.id, sessionId));
  }

  async getConversationHistory(
    sessionId: string,
    limit = 10
  ): Promise<Array<{ role: 'user' | 'assistant'; content: string; timestamp: string }>> {
    const context = await this.getContext(sessionId);
    const history = context.conversationHistory || [];
    return history.slice(-limit);
  }

  async addToConversationHistory(
    sessionId: string,
    role: 'user' | 'assistant',
    content: string
  ): Promise<void> {
    const context = await this.getContext(sessionId);
    const history = context.conversationHistory || [];
    history.push({
      role,
      content,
      timestamp: new Date().toISOString(),
    });
    await this.updateContext(sessionId, { ...context, conversationHistory: history });
  }
}
