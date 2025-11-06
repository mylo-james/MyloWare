import { describe, it, expect } from 'vitest';
import {
  stripWorkflowParams,
  mapWorkflowParams,
  normalizeToolParams,
} from '@/utils/workflow-params.js';

describe('workflow-params', () => {
  describe('stripWorkflowParams', () => {
    it('should strip workflow-specific parameters', () => {
      const params = {
        query: 'test query',
        limit: 10,
        sessionId: 'telegram:123',
        format: 'bullets',
        searchMode: 'keyword',
        role: 'assistant',
        embeddingText: 'test embedding',
      };

      const result = stripWorkflowParams(params);

      expect(result).toEqual({
        query: 'test query',
        limit: 10,
      });
      expect(result).not.toHaveProperty('sessionId');
      expect(result).not.toHaveProperty('format');
      expect(result).not.toHaveProperty('searchMode');
      expect(result).not.toHaveProperty('role');
      expect(result).not.toHaveProperty('embeddingText');
    });

    it('should preserve all non-workflow parameters', () => {
      const params = {
        query: 'test',
        project: 'aismr',
        persona: 'casey',
        limit: 20,
        temporalBoost: true,
        expandGraph: false,
      };

      const result = stripWorkflowParams(params);

      expect(result).toEqual(params);
    });
  });

  describe('mapWorkflowParams', () => {
    it('should separate tool params from workflow metadata', () => {
      const params = {
        query: 'test query',
        limit: 10,
        sessionId: 'telegram:123',
        format: 'bullets',
        searchMode: 'hybrid',
      };

      const result = mapWorkflowParams(params, 'memory_search');

      expect(result.toolParams).toEqual({
        query: 'test query',
        limit: 10,
      });
      expect(result.metadata).toEqual({
        sessionId: 'telegram:123',
        format: 'bullets',
        searchMode: 'hybrid',
      });
    });
  });

  describe('normalizeToolParams', () => {
    it('should parse JSON strings and strip workflow fields', () => {
      const raw = JSON.stringify({ query: 'ideas', sessionId: 'abc' });
      expect(normalizeToolParams(raw)).toEqual({ query: 'ideas' });
    });

    it('should unwrap arguments wrappers', () => {
      const raw = {
        arguments: {
          query: 'hello',
          limit: 5,
        },
        sessionId: 'telegram:42',
      };

      expect(normalizeToolParams(raw)).toEqual({ query: 'hello', limit: 5 });
    });

    it('should flatten query wrappers with tool metadata', () => {
      const raw = {
        query: { intent: 'make video' },
        tool: { name: 'workflow_discover' },
      };

      expect(normalizeToolParams(raw)).toEqual({ intent: 'make video' });
    });
  });
});
