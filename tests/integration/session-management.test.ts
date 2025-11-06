import { describe, it, expect, beforeEach } from 'vitest';
import { SessionRepository } from '@/db/repositories/session-repository.js';
import { db } from '@/db/client.js';
import { sessions } from '@/db/schema.js';

describe('Session Management Integration', () => {
  let repository: SessionRepository;

  beforeEach(async () => {
    await db.delete(sessions);
    repository = new SessionRepository();
  });

  it('should preserve full userId with platform prefix', async () => {
    const sessionId = 'telegram:123456789';
    const session = await repository.findOrCreate(
      sessionId,
      sessionId, // Full userId with platform prefix
      'casey',
      'aismr'
    );

    expect(session.id).toBe(sessionId);
    expect(session.userId).toBe(sessionId); // Should preserve full ID
    expect(session.persona).toBe('casey');
    expect(session.project).toBe('aismr');
  });

  it('should use stored persona/project for existing sessions', async () => {
    const sessionId = 'telegram:123456789';
    
    // Create initial session
    await repository.findOrCreate(sessionId, sessionId, 'casey', 'aismr');
    
    // Get existing session
    const existing = await repository.findById(sessionId);
    expect(existing).not.toBeNull();
    expect(existing?.persona).toBe('casey');
    expect(existing?.project).toBe('aismr');
    
    // Subsequent calls should preserve values
    const session2 = await repository.findOrCreate(
      sessionId,
      sessionId,
      'ideagenerator', // Different persona
      'test' // Different project
    );
    
    // Should still use original values (findOrCreate returns existing if found)
    expect(session2.persona).toBe('casey');
    expect(session2.project).toBe('aismr');
  });

  it('should handle different platform prefixes', async () => {
    const telegramSession = await repository.findOrCreate(
      'telegram:123',
      'telegram:123',
      'chat',
      'aismr'
    );
    
    const apiSession = await repository.findOrCreate(
      'api:user-456',
      'api:user-456',
      'chat',
      'aismr'
    );

    expect(telegramSession.userId).toBe('telegram:123');
    expect(apiSession.userId).toBe('api:user-456');
    
    // Sessions should be distinct
    expect(telegramSession.id).not.toBe(apiSession.id);
  });

  it('should update last interaction timestamp', async () => {
    const sessionId = 'telegram:123';
    const session1 = await repository.findOrCreate(
      sessionId,
      sessionId,
      'chat',
      'aismr'
    );
    
    const initialTime = session1.lastInteractionAt;
    
    // Wait a bit
    await new Promise((resolve) => setTimeout(resolve, 100));
    
    // Call again (should update timestamp)
    const session2 = await repository.findOrCreate(
      sessionId,
      sessionId,
      'chat',
      'aismr'
    );
    
    expect(session2.lastInteractionAt.getTime()).toBeGreaterThan(
      initialTime.getTime()
    );
  });

  it('should store and retrieve context', async () => {
    const sessionId = 'telegram:123';
    await repository.findOrCreate(sessionId, sessionId, 'chat', 'aismr');
    
    const context = {
      lastIntent: 'generate ideas',
      recentTopics: ['rain', 'ambient sounds'],
      preferences: { format: 'bullets' },
    };
    
    await repository.updateContext(sessionId, context);
    
    const retrieved = await repository.getContext(sessionId);
    expect(retrieved.lastIntent).toBe('generate ideas');
    expect(retrieved.recentTopics).toEqual(['rain', 'ambient sounds']);
    expect(retrieved.preferences).toEqual({ format: 'bullets' });
  });
});

