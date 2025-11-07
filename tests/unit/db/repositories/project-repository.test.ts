import { describe, it, expect, beforeEach } from 'vitest';
import { ProjectRepository } from '@/db/repositories/project-repository.js';
import { db } from '@/db/client.js';
import { projects } from '@/db/schema.js';

describe('ProjectRepository', () => {
  const repository = new ProjectRepository();

  beforeEach(async () => {
    await db.delete(projects);
  });

  describe('insert', () => {
    it('should insert a project with workflow and optionalSteps', async () => {
      const project = await repository.insert({
        name: 'test-project',
        description: 'Test Project',
        workflow: ['casey', 'iggy', 'riley', 'veo', 'alex', 'quinn'],
        optionalSteps: ['alex'],
        guardrails: {},
        settings: {},
        metadata: {},
      });

      expect(project.id).toBeDefined();
      expect(project.name).toBe('test-project');
      expect(project.workflow).toEqual(['casey', 'iggy', 'riley', 'veo', 'alex', 'quinn']);
      expect(project.optionalSteps).toEqual(['alex']);
      expect(project.createdAt).toBeInstanceOf(Date);
    });

    it('should insert a project with empty optionalSteps', async () => {
      const project = await repository.insert({
        name: 'test-project-empty',
        description: 'Test Project Empty',
        workflow: ['casey', 'iggy'],
        optionalSteps: [],
        guardrails: {},
        settings: {},
        metadata: {},
      });

      expect(project.workflow).toEqual(['casey', 'iggy']);
      expect(project.optionalSteps).toEqual([]);
    });

    it('should throw error if optionalSteps is not a subset of workflow', async () => {
      await expect(
        repository.insert({
          name: 'test-project-invalid',
          description: 'Test Project Invalid',
          workflow: ['casey', 'iggy'],
          optionalSteps: ['alex'], // 'alex' is not in workflow
          guardrails: {},
          settings: {},
          metadata: {},
        })
      ).rejects.toThrow('optionalSteps must be a subset of workflow');
    });

    it('should allow optionalSteps to be empty even if workflow has steps', async () => {
      const project = await repository.insert({
        name: 'test-project-no-optional',
        description: 'Test Project No Optional',
        workflow: ['casey', 'iggy', 'riley', 'veo', 'alex', 'quinn'],
        optionalSteps: [],
        guardrails: {},
        settings: {},
        metadata: {},
      });

      expect(project.optionalSteps).toEqual([]);
    });
  });

  describe('findByName', () => {
    it('should find a project by name with workflow and optionalSteps', async () => {
      await repository.insert({
        name: 'test-project-find',
        description: 'Test Project Find',
        workflow: ['casey', 'iggy', 'riley'],
        optionalSteps: ['riley'],
        guardrails: {},
        settings: {},
        metadata: {},
      });

      const project = await repository.findByName('test-project-find');

      expect(project).not.toBeNull();
      expect(project?.name).toBe('test-project-find');
      expect(project?.workflow).toEqual(['casey', 'iggy', 'riley']);
      expect(project?.optionalSteps).toEqual(['riley']);
    });

    it('should return null if project not found', async () => {
      const project = await repository.findByName('non-existent');
      expect(project).toBeNull();
    });
  });

  describe('findAll', () => {
    it('should return all projects with workflow and optionalSteps', async () => {
      await repository.insert({
        name: 'project-1',
        description: 'Project 1',
        workflow: ['casey', 'iggy'],
        optionalSteps: [],
        guardrails: {},
        settings: {},
        metadata: {},
      });

      await repository.insert({
        name: 'project-2',
        description: 'Project 2',
        workflow: ['casey', 'iggy', 'riley', 'veo', 'alex', 'quinn'],
        optionalSteps: ['alex'],
        guardrails: {},
        settings: {},
        metadata: {},
      });

      const allProjects = await repository.findAll();

      expect(allProjects.length).toBe(2);
      expect(allProjects[0]?.workflow).toBeDefined();
      expect(allProjects[0]?.optionalSteps).toBeDefined();
      expect(allProjects[1]?.workflow).toBeDefined();
      expect(allProjects[1]?.optionalSteps).toBeDefined();
    });
  });
});

