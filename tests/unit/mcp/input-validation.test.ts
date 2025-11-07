import { describe, it, expect, beforeEach } from 'vitest';
import { mcpTools } from '@/mcp/tools.js';
import { db } from '@/db/client.js';
import { memories, executionTraces } from '@/db/schema.js';
import { TraceRepository } from '@/db/repositories/trace-repository.js';
import { z } from 'zod';

const getTool = (name: string) => {
  const tool = mcpTools.find((t) => t.name === name);
  if (!tool) {
    throw new Error(`Tool not found: ${name}`);
  }
  return tool;
};

describe('Input Validation Limits', () => {
  beforeEach(async () => {
    await db.delete(memories);
    await db.delete(executionTraces);
  });

  describe('memory_search query field', () => {
    it('should accept query within 10000 character limit', async () => {
      const tool = getTool('memory_search');
      const validQuery = 'a'.repeat(10000);
      
      // Should not throw validation error
      await expect(
        tool.handler({ query: validQuery }, 'test-request-id')
      ).resolves.toBeDefined();
    });

    it('should reject query exceeding 10000 character limit', async () => {
      const tool = getTool('memory_search');
      const invalidQuery = 'a'.repeat(10001);
      
      // Should throw Zod validation error
      await expect(
        tool.handler({ query: invalidQuery }, 'test-request-id')
      ).rejects.toThrow('10000 characters or less');
    });
  });

  describe('memory_store content field', () => {
    it('should accept content within 50000 character limit', async () => {
      const tool = getTool('memory_store');
      const validContent = 'a'.repeat(50000);
      
      // Should not throw validation error
      await expect(
        tool.handler(
          {
            content: validContent,
            memoryType: 'episodic',
          },
          'test-request-id'
        )
      ).resolves.toBeDefined();
    });

    it('should reject content exceeding 50000 character limit', async () => {
      const tool = getTool('memory_store');
      const invalidContent = 'a'.repeat(50001);
      
      // Should throw Zod validation error
      await expect(
        tool.handler(
          {
            content: invalidContent,
            memoryType: 'episodic',
          },
          'test-request-id'
        )
      ).rejects.toThrow('50000 characters or less');
    });
  });

  describe('trace_update instructions field', () => {
    it('should accept instructions within 10000 character limit', async () => {
      const traceRepo = new TraceRepository();
      const trace = await traceRepo.create({
        projectId: 'test-project',
        sessionId: 'test-session',
      });

      const tool = getTool('trace_update');
      const validInstructions = 'a'.repeat(10000);
      
      // Should not throw validation error
      await expect(
        tool.handler(
          {
            traceId: trace.traceId,
            instructions: validInstructions,
          },
          'test-request-id'
        )
      ).resolves.toBeDefined();
    });

    it('should reject instructions exceeding 10000 character limit', async () => {
      const traceRepo = new TraceRepository();
      const trace = await traceRepo.create({
        projectId: 'test-project',
        sessionId: 'test-session',
      });

      const tool = getTool('trace_update');
      const invalidInstructions = 'a'.repeat(10001);
      
      // Should throw Zod validation error
      await expect(
        tool.handler(
          {
            traceId: trace.traceId,
            instructions: invalidInstructions,
          },
          'test-request-id'
        )
      ).rejects.toThrow('10000 characters or less');
    });
  });

  describe('handoff_to_agent instructions field', () => {
    it('should accept instructions within 10000 character limit', async () => {
      const traceRepo = new TraceRepository();
      const trace = await traceRepo.create({
        projectId: 'test-project',
        sessionId: 'test-session',
      });

      const tool = getTool('handoff_to_agent');
      const validInstructions = 'a'.repeat(10000);
      
      // Should not throw validation error (may fail on webhook, but validation should pass)
      try {
        await tool.handler(
          {
            traceId: trace.traceId,
            toAgent: 'iggy',
            instructions: validInstructions,
          },
          'test-request-id'
        );
      } catch (error) {
        // Validation should pass, other errors (like webhook) are acceptable
        expect(error).not.toBeInstanceOf(z.ZodError);
      }
    });

    it('should reject instructions exceeding 10000 character limit', async () => {
      const traceRepo = new TraceRepository();
      const trace = await traceRepo.create({
        projectId: 'test-project',
        sessionId: 'test-session',
      });

      const tool = getTool('handoff_to_agent');
      const invalidInstructions = 'a'.repeat(10001);
      
      // Should throw Zod validation error
      await expect(
        tool.handler(
          {
            traceId: trace.traceId,
            toAgent: 'iggy',
            instructions: invalidInstructions,
          },
          'test-request-id'
        )
      ).rejects.toThrow('10000 characters or less');
    });
  });

  describe('trace_prepare instructions field', () => {
    it('should accept instructions within 10000 character limit', async () => {
      const tool = getTool('trace_prepare');
      const validInstructions = 'a'.repeat(10000);
      
      // Should not throw validation error
      await expect(
        tool.handler(
          {
            instructions: validInstructions,
          },
          'test-request-id'
        )
      ).resolves.toBeDefined();
    });

    it('should reject instructions exceeding 10000 character limit', async () => {
      const tool = getTool('trace_prepare');
      const invalidInstructions = 'a'.repeat(10001);
      
      // Should throw Zod validation error
      await expect(
        tool.handler(
          {
            instructions: invalidInstructions,
          },
          'test-request-id'
        )
      ).rejects.toThrow('10000 characters or less');
    });
  });
});

