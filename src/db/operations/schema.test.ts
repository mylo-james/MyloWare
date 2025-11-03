import { describe, it, expect } from 'vitest';
import {
  workflowRuns,
  workflowRunStatusEnum,
  workflowStageEnum,
  type WorkflowRun,
  type WorkflowRunStatus,
  type WorkflowStage,
} from './schema';

describe('Workflow Schema', () => {
  describe('Enums', () => {
    it('workflowRunStatusEnum has correct values', () => {
      const values = workflowRunStatusEnum.enumValues;
      expect(values).toContain('running');
      expect(values).toContain('completed');
      expect(values).toContain('failed');
      expect(values).toContain('needs_revision');
      expect(values).toHaveLength(4);
    });

    it('workflowStageEnum has correct values', () => {
      const values = workflowStageEnum.enumValues;
      expect(values).toContain('idea_generation');
      expect(values).toContain('screenplay');
      expect(values).toContain('video_generation');
      expect(values).toContain('publishing');
      expect(values).toHaveLength(4);
    });
  });

  describe('Table Schemas', () => {
    it('workflowRuns table exposes expected columns', () => {
      expect(workflowRuns).toBeDefined();
      const requiredColumns = [
        'id',
        'projectId',
        'sessionId',
        'currentStage',
        'status',
        'stages',
        'input',
        'output',
        'workflowDefinitionChunkId',
        'createdAt',
        'updatedAt',
      ];

      for (const column of requiredColumns) {
        expect(workflowRuns).toHaveProperty(column);
      }
    });
  });

  describe('Type Exports', () => {
    it('WorkflowRun type is defined', () => {
      const testRun: WorkflowRun = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        projectId: 'aismr',
        sessionId: '123e4567-e89b-12d3-a456-426614174001',
        currentStage: 'idea_generation',
        status: 'running',
        stages: {
          idea_generation: { status: 'pending' },
          screenplay: { status: 'pending' },
          video_generation: { status: 'pending' },
          publishing: { status: 'pending' },
        },
        input: {},
        output: null,
        workflowDefinitionChunkId: null,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      };
      expect(testRun).toBeDefined();
    });
    it('WorkflowRunStatus type accepts all enum values', () => {
      const statuses: WorkflowRunStatus[] = [
        'running',
        'completed',
        'failed',
        'needs_revision',
      ];
      expect(statuses).toHaveLength(4);
    });

    it('WorkflowStage type accepts all enum values', () => {
      const stages: WorkflowStage[] = [
        'idea_generation',
        'screenplay',
        'video_generation',
        'publishing',
      ];
      expect(stages).toHaveLength(4);
    });
  });
});
