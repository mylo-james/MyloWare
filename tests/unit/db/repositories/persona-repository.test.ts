import { describe, it, expect, beforeEach } from 'vitest';
import { PersonaRepository } from '@/db/repositories/persona-repository.js';
import { db } from '@/db/client.js';
import { personas } from '@/db/schema.js';

describe('PersonaRepository', () => {
  const repository = new PersonaRepository();

  beforeEach(async () => {
    await db.delete(personas);
  });

  describe('insert', () => {
    it('should insert a persona with allowedTools', async () => {
      const persona = await repository.insert({
        name: 'test-persona',
        description: 'Test Persona',
        capabilities: ['test'],
        tone: 'friendly',
        defaultProject: 'aismr',
        systemPrompt: 'Test prompt',
        allowedTools: ['memory_search', 'memory_store', 'handoff_to_agent'],
        metadata: {},
      });

      expect(persona.id).toBeDefined();
      expect(persona.name).toBe('test-persona');
      expect(persona.allowedTools).toEqual(['memory_search', 'memory_store', 'handoff_to_agent']);
      expect(persona.createdAt).toBeInstanceOf(Date);
    });

    it('should insert a persona with empty allowedTools array', async () => {
      const persona = await repository.insert({
        name: 'test-persona-empty',
        description: 'Test Persona Empty',
        capabilities: ['test'],
        tone: 'friendly',
        defaultProject: null,
        systemPrompt: null,
        allowedTools: [],
        metadata: {},
      });

      expect(persona.allowedTools).toEqual([]);
    });
  });

  describe('findByName', () => {
    it('should find a persona by name with allowedTools', async () => {
      await repository.insert({
        name: 'casey',
        description: 'Showrunner',
        capabilities: ['coordination'],
        tone: 'confident',
        defaultProject: 'aismr',
        systemPrompt: 'You are Casey',
        allowedTools: ['trace_update', 'memory_search', 'memory_store', 'handoff_to_agent'],
        metadata: {},
      });

      const found = await repository.findByName('casey');

      expect(found).not.toBeNull();
      expect(found?.name).toBe('casey');
      expect(found?.allowedTools).toEqual(['trace_update', 'memory_search', 'memory_store', 'handoff_to_agent']);
    });

    it('should return null if persona not found', async () => {
      const found = await repository.findByName('nonexistent');
      expect(found).toBeNull();
    });

    it('should return persona with empty allowedTools if not set', async () => {
      await repository.insert({
        name: 'test-empty',
        description: 'Test',
        capabilities: ['test'],
        tone: 'friendly',
        defaultProject: null,
        systemPrompt: null,
        allowedTools: [],
        metadata: {},
      });

      const found = await repository.findByName('test-empty');
      expect(found?.allowedTools).toEqual([]);
    });
  });

  describe('findAll', () => {
    it('should return all personas with allowedTools', async () => {
      await repository.insert({
        name: 'persona1',
        description: 'Persona 1',
        capabilities: ['test'],
        tone: 'friendly',
        defaultProject: null,
        systemPrompt: null,
        allowedTools: ['memory_search'],
        metadata: {},
      });

      await repository.insert({
        name: 'persona2',
        description: 'Persona 2',
        capabilities: ['test'],
        tone: 'friendly',
        defaultProject: null,
        systemPrompt: null,
        allowedTools: ['memory_store', 'handoff_to_agent'],
        metadata: {},
      });

      const all = await repository.findAll();

      expect(all.length).toBe(2);
      expect(all[0]?.allowedTools).toBeDefined();
      expect(all[1]?.allowedTools).toBeDefined();
      expect(all.find(p => p.name === 'persona1')?.allowedTools).toEqual(['memory_search']);
      expect(all.find(p => p.name === 'persona2')?.allowedTools).toEqual(['memory_store', 'handoff_to_agent']);
    });
  });

  describe('deleteAll', () => {
    it('should remove all personas and return deleted count', async () => {
      await repository.insert({
        name: 'persona-a',
        description: 'Persona A',
        capabilities: ['test'],
        tone: 'neutral',
        defaultProject: null,
        systemPrompt: null,
        allowedTools: [],
        metadata: {},
      });

      await repository.insert({
        name: 'persona-b',
        description: 'Persona B',
        capabilities: ['test'],
        tone: 'neutral',
        defaultProject: null,
        systemPrompt: null,
        allowedTools: [],
        metadata: {},
      });

      const deleted = await repository.deleteAll();

      expect(deleted).toBe(2);
      const remaining = await repository.findAll();
      expect(remaining.length).toBe(0);
    });
  });
});

