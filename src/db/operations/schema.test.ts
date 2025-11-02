import { describe, it, expect } from 'vitest';
import {
  workflowRuns,
  hitlApprovals,
  workflowRunStatusEnum,
  workflowStageEnum,
  hitlApprovalStatusEnum,
  type WorkflowRun,
  type HITLApproval,
  type WorkflowRunStatus,
  type WorkflowStage,
  type HITLApprovalStatus,
} from './schema';

describe('HITL Schema', () => {
  describe('Enums', () => {
    it('workflowRunStatusEnum has correct values', () => {
      const values = workflowRunStatusEnum.enumValues;
      expect(values).toContain('running');
      expect(values).toContain('waiting_for_hitl');
      expect(values).toContain('completed');
      expect(values).toContain('failed');
      expect(values).toContain('needs_revision');
      expect(values).toHaveLength(5);
    });

    it('workflowStageEnum has correct values', () => {
      const values = workflowStageEnum.enumValues;
      expect(values).toContain('idea_generation');
      expect(values).toContain('screenplay');
      expect(values).toContain('video_generation');
      expect(values).toContain('publishing');
      expect(values).toHaveLength(4);
    });

    it('hitlApprovalStatusEnum has correct values', () => {
      const values = hitlApprovalStatusEnum.enumValues;
      expect(values).toContain('pending');
      expect(values).toContain('approved');
      expect(values).toContain('rejected');
      expect(values).toHaveLength(3);
    });
  });

  describe('Table Schemas', () => {
    it('workflowRuns table exposes expected columns', () => {
      expect(workflowRuns).toBeDefined();
      const columns = workflowRuns._.columns;
      expect(columns).toHaveProperty('id');
      expect(columns).toHaveProperty('projectId');
      expect(columns).toHaveProperty('sessionId');
      expect(columns).toHaveProperty('currentStage');
      expect(columns).toHaveProperty('status');
      expect(columns).toHaveProperty('stages');
      expect(columns).toHaveProperty('input');
      expect(columns).toHaveProperty('output');
      expect(columns).toHaveProperty('workflowDefinitionChunkId');
      expect(columns).toHaveProperty('createdAt');
      expect(columns).toHaveProperty('updatedAt');
    });

    it('hitlApprovals table exposes expected columns', () => {
      expect(hitlApprovals).toBeDefined();
      const columns = hitlApprovals._.columns;
      expect(columns).toHaveProperty('id');
      expect(columns).toHaveProperty('workflowRunId');
      expect(columns).toHaveProperty('stage');
      expect(columns).toHaveProperty('content');
      expect(columns).toHaveProperty('status');
      expect(columns).toHaveProperty('reviewedBy');
      expect(columns).toHaveProperty('reviewedAt');
      expect(columns).toHaveProperty('feedback');
      expect(columns).toHaveProperty('createdAt');
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

    it('HITLApproval type is defined', () => {
      const testApproval: HITLApproval = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        workflowRunId: '123e4567-e89b-12d3-a456-426614174001',
        stage: 'idea_generation',
        content: { ideas: [] },
        status: 'pending',
        reviewedBy: null,
        reviewedAt: null,
        feedback: null,
        createdAt: '2025-01-01T00:00:00Z',
      };
      expect(testApproval).toBeDefined();
    });

    it('WorkflowRunStatus type accepts all enum values', () => {
      const statuses: WorkflowRunStatus[] = [
        'running',
        'waiting_for_hitl',
        'completed',
        'failed',
        'needs_revision',
      ];
      expect(statuses).toHaveLength(5);
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

    it('HITLApprovalStatus type accepts all enum values', () => {
      const statuses: HITLApprovalStatus[] = ['pending', 'approved', 'rejected'];
      expect(statuses).toHaveLength(3);
    });
  });
});
