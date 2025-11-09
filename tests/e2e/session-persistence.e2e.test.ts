import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { SessionRepository } from '@/db/repositories/session-repository.js';
import { db } from '@/db/client.js';
import { sessions } from '@/db/schema.js';

describe('Session Persistence E2E', () => {
  beforeAll(async () => {
    // Ensure database is ready
  });

  beforeEach(async () => {
    // Clean up test data
    await db.delete(sessions);
  });

  it('should persist context across interactions', async () => {
    const sessionRepo = new SessionRepository();
    const sessionId = 'telegram:persistence-test';
    
    // First interaction
    await sessionRepo.findOrCreate(sessionId, 'mylo', 'chat', 'aismr');
    await sessionRepo.updateContext(sessionId, {
      lastIntent: 'generate-ideas',
      recentTopics: ['rain'],
      preferences: { style: 'gentle' }
    });
    
    // Second interaction (simulate restart)
    const session = await sessionRepo.findOrCreate(sessionId, 'mylo', 'casey', 'aismr');
    const context = await sessionRepo.getContext(sessionId);
    
    expect(context.lastIntent).toBe('generate-ideas');
    expect(context.recentTopics).toContain('rain');
    expect(context.preferences).toEqual({ style: 'gentle' });
    expect(session.id).toBe(sessionId);
  });
  
  it('should persist conversation history', async () => {
    const sessionRepo = new SessionRepository();
    const sessionId = 'telegram:history-test';
    
    await sessionRepo.findOrCreate(sessionId, 'mylo', 'chat', 'aismr');
    
    // Add conversation entries
    await sessionRepo.addToConversationHistory(sessionId, 'user', 'Generate ideas about rain');
    await sessionRepo.addToConversationHistory(sessionId, 'assistant', 'Here are some ideas...');
    
    // Retrieve history
    const history = await sessionRepo.getConversationHistory(sessionId);
    
    expect(history.length).toBe(2);
    expect(history[0].role).toBe('user');
    expect(history[0].content).toBe('Generate ideas about rain');
    expect(history[1].role).toBe('assistant');
    expect(history[1].content).toBe('Here are some ideas...');
    
    // Verify timestamps
    expect(history[0].timestamp).toBeDefined();
    expect(history[1].timestamp).toBeDefined();
  });
  
  it('should update last interaction timestamp', async () => {
    const sessionRepo = new SessionRepository();
    const sessionId = 'telegram:timestamp-test';
    
    const session1 = await sessionRepo.findOrCreate(sessionId, 'mylo', 'casey', 'aismr');
    const firstInteraction = session1.lastInteractionAt;
    
    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 10));
    
    // Update interaction
    await sessionRepo.updateLastInteraction(sessionId);
    const session2 = await sessionRepo.findOrCreate(sessionId, 'mylo', 'casey', 'aismr');
    
    expect(session2.lastInteractionAt.getTime()).toBeGreaterThan(firstInteraction.getTime());
  });
  
  it('should handle context updates correctly', async () => {
    const sessionRepo = new SessionRepository();
    const sessionId = 'telegram:context-update-test';
    
    await sessionRepo.findOrCreate(sessionId, 'mylo', 'chat', 'aismr');
    
    // Initial context
    await sessionRepo.updateContext(sessionId, {
      lastIntent: 'generate-ideas',
      recentTopics: ['rain']
    });
    
    // Update with new values
    await sessionRepo.updateContext(sessionId, {
      lastIntent: 'write-screenplay',
      recentTopics: ['rain', 'cozy'],
      preferences: { format: 'long-form' }
    });
    
    const context = await sessionRepo.getContext(sessionId);
    
    expect(context.lastIntent).toBe('write-screenplay');
    expect(context.recentTopics).toEqual(['rain', 'cozy']);
    expect(context.preferences).toEqual({ format: 'long-form' });
  });
});
