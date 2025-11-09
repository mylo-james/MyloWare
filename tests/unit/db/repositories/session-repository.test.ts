import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { SessionRepository } from '@/db/repositories/session-repository.js';
import { db } from '@/db/client.js';
import { sessions } from '@/db/schema.js';

describe('SessionRepository', () => {
  const repository = new SessionRepository();

  beforeAll(async () => {
    // Ensure database is ready
  });

  beforeEach(async () => {
    await db.delete(sessions);
  });

  describe('findOrCreate', () => {
    it('should create new session when not exists', async () => {
      const session = await repository.findOrCreate(
        'test-session-1',
        'test-user',
        'chat',
        'aismr'
      );

      expect(session.id).toBe('test-session-1');
      expect(session.userId).toBe('test-user');
      expect(session.persona).toBe('chat');
      expect(session.project).toBe('aismr');
    });

    it('should return existing session when exists', async () => {
      await repository.findOrCreate('test-session-2', 'test-user', 'chat', 'aismr');
      
      const session = await repository.findOrCreate(
        'test-session-2',
        'test-user',
        'chat',
        'aismr'
      );

      expect(session.id).toBe('test-session-2');
    });
  });

  describe('updateLastInteraction', () => {
    it('should update last interaction timestamp', async () => {
      const session = await repository.findOrCreate(
        'test-session-3',
        'test-user',
        'chat',
        'aismr'
      );
      const firstInteraction = session.lastInteractionAt;

      await new Promise(resolve => setTimeout(resolve, 10));
      await repository.updateLastInteraction('test-session-3');
      
      const updated = await repository.findOrCreate(
        'test-session-3',
        'test-user',
        'chat',
        'aismr'
      );

      expect(updated.lastInteractionAt.getTime()).toBeGreaterThan(firstInteraction.getTime());
    });
  });

  describe('getContext', () => {
    it('should return empty context for new session', async () => {
      await repository.findOrCreate('test-session-4', 'test-user', 'casey', 'aismr');
      
      const context = await repository.getContext('test-session-4');
      
      expect(context).toEqual({});
    });

    it('should return stored context', async () => {
      await repository.findOrCreate('test-session-5', 'test-user', 'casey', 'aismr');
      await repository.updateContext('test-session-5', {
        lastIntent: 'generate-ideas',
        recentTopics: ['rain']
      });
      
      const context = await repository.getContext('test-session-5');
      
      expect(context.lastIntent).toBe('generate-ideas');
      expect(context.recentTopics).toEqual(['rain']);
    });
  });

  describe('updateContext', () => {
    it('should update context', async () => {
      await repository.findOrCreate('test-session-6', 'test-user', 'casey', 'aismr');
      
      await repository.updateContext('test-session-6', {
        lastIntent: 'write-screenplay',
        preferences: { format: 'long' }
      });
      
      const context = await repository.getContext('test-session-6');
      
      expect(context.lastIntent).toBe('write-screenplay');
      expect(context.preferences).toEqual({ format: 'long' });
    });
  });

  describe('getConversationHistory', () => {
    it('should return empty history for new session', async () => {
      await repository.findOrCreate('test-session-7', 'test-user', 'casey', 'aismr');
      
      const history = await repository.getConversationHistory('test-session-7');
      
      expect(history).toEqual([]);
    });

    it('should return conversation history', async () => {
      await repository.findOrCreate('test-session-8', 'test-user', 'casey', 'aismr');
      await repository.addToConversationHistory('test-session-8', 'user', 'Hello');
      await repository.addToConversationHistory('test-session-8', 'assistant', 'Hi there');
      
      const history = await repository.getConversationHistory('test-session-8');
      
      expect(history.length).toBe(2);
      expect(history[0].role).toBe('user');
      expect(history[0].content).toBe('Hello');
      expect(history[1].role).toBe('assistant');
      expect(history[1].content).toBe('Hi there');
    });

    it('should limit history by limit parameter', async () => {
      await repository.findOrCreate('test-session-9', 'test-user', 'casey', 'aismr');
      
      for (let i = 0; i < 5; i++) {
        await repository.addToConversationHistory('test-session-9', 'user', `Message ${i}`);
      }
      
      const history = await repository.getConversationHistory('test-session-9', 3);
      
      expect(history.length).toBe(3);
    });
  });

  describe('addToConversationHistory', () => {
    it('should add entry to conversation history', async () => {
      await repository.findOrCreate('test-session-10', 'test-user', 'casey', 'aismr');
      
      await repository.addToConversationHistory('test-session-10', 'user', 'Test message');
      
      const history = await repository.getConversationHistory('test-session-10');
      
      expect(history.length).toBe(1);
      expect(history[0].role).toBe('user');
      expect(history[0].content).toBe('Test message');
      expect(history[0].timestamp).toBeDefined();
    });
  });
});
