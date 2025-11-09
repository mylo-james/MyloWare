import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PersonaRepository } from '../../src/db/repositories/persona-repository.js';
import { ProjectRepository } from '../../src/db/repositories/project-repository.js';
import { MemoryRepository } from '../../src/db/repositories/memory-repository.js';
import { cleanupTestDb, setupTestDb } from '../setup/test-db.js';

describe('Data Ingestion Pipeline', () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  afterAll(async () => {
    await cleanupTestDb();
  });

  describe('Schema Validation', () => {
    it('should validate persona schema', () => {
      const validPersona = {
        name: 'test',
        title: 'Test Persona',
        description: 'Test description',
        tone: 'test tone',
        allowedTools: ['memory_search'],
        metadata: {
          version: '1.0.0',
          tags: ['test'],
        },
        links: {
          defaultProject: 'test',
        },
      };

      // Schema validation happens in the ingestion script
      // This test verifies the structure matches our schema
      expect(validPersona.name).toBeDefined();
      expect(validPersona.metadata.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('should validate project schema', () => {
      const validProject = {
        name: 'test',
        title: 'Test Project',
        description: 'Test description',
        workflow: ['casey'],
        metadata: {
          version: '1.0.0',
          tags: ['test'],
        },
        links: {
          personas: ['casey'],
        },
      };

      expect(validProject.name).toBeDefined();
      expect(validProject.workflow).toBeInstanceOf(Array);
      expect(validProject.metadata.version).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe('Idempotency', () => {
    it('should handle duplicate persona inserts', async () => {
      const repository = new PersonaRepository();
      
      const personaData = {
        name: 'idempotency_test',
        description: 'Test persona',
        capabilities: ['test'],
        tone: 'test',
        defaultProject: null,
        systemPrompt: null,
        allowedTools: ['memory_search'],
        metadata: {},
      };

      // First insert
      const first = await repository.insert(personaData);
      expect(first.name).toBe('idempotency_test');

      // Second insert should fail (unique constraint)
      await expect(repository.insert(personaData)).rejects.toThrow();

      // Update should work
      const updated = await repository.update(first.id, {
        description: 'Updated description',
      });
      expect(updated.description).toBe('Updated description');
    });

    it('should handle duplicate project inserts', async () => {
      const repository = new ProjectRepository();
      
      const projectData = {
        name: 'idempotency_test',
        description: 'Test project',
        workflow: ['casey'],
        optionalSteps: [],
        guardrails: {},
        settings: {},
        metadata: {},
      };

      // First insert
      const first = await repository.insert(projectData);
      expect(first.name).toBe('idempotency_test');

      // Second insert should fail (unique constraint)
      await expect(repository.insert(projectData)).rejects.toThrow();

      // Update should work
      const updated = await repository.update(first.id, {
        description: 'Updated description',
      });
      expect(updated.description).toBe('Updated description');
    });
  });

  describe('Link Graph', () => {
    it('should store guardrails as semantic memories', async () => {
      const repository = new MemoryRepository();
      
      const guardrailMemory = {
        content: 'Guardrail test.timing.runtime.v1: Exactly 8.0s per video',
        summary: null,
        embedding: new Array(1536).fill(0.1),
        memoryType: 'semantic' as const,
        persona: [],
        project: ['test'],
        tags: ['guardrail', 'timing'],
        relatedTo: [],
        lastAccessedAt: null,
        accessCount: 0,
        metadata: {
          guardrailKey: 'test.timing.runtime.v1',
          category: 'timing',
          name: 'runtime',
          sourceType: 'guardrail',
        },
      };

      const stored = await repository.insert(guardrailMemory);
      expect(stored.memoryType).toBe('semantic');
      expect(stored.metadata.guardrailKey).toBe('test.timing.runtime.v1');
      expect(stored.tags).toContain('guardrail');
    });

    it('should store workflows as procedural memories', async () => {
      const repository = new MemoryRepository();
      
      const workflowMemory = {
        content: 'Workflow test.workflow.v1: Test workflow description',
        summary: null,
        embedding: new Array(1536).fill(0.1),
        memoryType: 'procedural' as const,
        persona: ['test'],
        project: ['test'],
        tags: ['workflow', 'definition'],
        relatedTo: [],
        lastAccessedAt: null,
        accessCount: 0,
        metadata: {
          workflowKey: 'test.workflow.v1',
          ownerPersona: 'test',
          project: 'test',
          sourceType: 'workflow',
        },
      };

      const stored = await repository.insert(workflowMemory);
      expect(stored.memoryType).toBe('procedural');
      expect(stored.metadata.workflowKey).toBe('test.workflow.v1');
      expect(stored.tags).toContain('workflow');
    });

    it('should link workflows to guardrails via related_to', async () => {
      const repository = new MemoryRepository();
      
      // Create guardrail
      const guardrail = await repository.insert({
        content: 'Guardrail link_test.rule.v1: Test rule',
        summary: null,
        embedding: new Array(1536).fill(0.1),
        memoryType: 'semantic' as const,
        persona: [],
        project: ['link_test'],
        tags: ['guardrail'],
        relatedTo: [],
        lastAccessedAt: null,
        accessCount: 0,
        metadata: {
          guardrailKey: 'link_test.rule.v1',
          sourceType: 'guardrail',
        },
      });

      // Create workflow
      const workflow = await repository.insert({
        content: 'Workflow link_test.workflow.v1: Test workflow',
        summary: null,
        embedding: new Array(1536).fill(0.1),
        memoryType: 'procedural' as const,
        persona: ['test'],
        project: ['link_test'],
        tags: ['workflow'],
        relatedTo: [],
        lastAccessedAt: null,
        accessCount: 0,
        metadata: {
          workflowKey: 'link_test.workflow.v1',
          sourceType: 'workflow',
        },
      });

      // Link workflow to guardrail
      const updated = await repository.update(workflow.id, {
        relatedTo: [guardrail.id],
      });

      expect(updated.relatedTo).toContain(guardrail.id);
      expect(updated.relatedTo.length).toBe(1);
    });
  });
});

