import { describe, it, expect } from 'vitest';
import { mcpTools } from '@/mcp/tools.js';
import { z } from 'zod';

describe('MCP Tools', () => {
  it('should have all required tools registered', () => {
    const expectedTools = [
      'memory_search',
      'memory_store',
      'memory_evolve',
      'context_get_persona',
      'context_get_project',
      'workflow_discover',
      'workflow_execute',
      'workflow_status',
      'clarify_ask',
      'session_get_context',
      'session_update_context',
    ];

    const toolNames = mcpTools.map((t) => t.name);
    expect(toolNames.length).toBe(11);

    for (const expected of expectedTools) {
      expect(toolNames).toContain(expected);
    }
  });

  it('should have valid input schemas for all tools', () => {
    for (const tool of mcpTools) {
      expect(tool.inputSchema).toBeInstanceOf(z.ZodObject);
      expect(tool.handler).toBeInstanceOf(Function);
    }
  });

  it('should validate memory_search parameters', () => {
    const tool = mcpTools.find((t) => t.name === 'memory_search');
    expect(tool).toBeDefined();

    const schema = tool!.inputSchema as z.ZodObject<any>;
    const valid = schema.safeParse({
      query: 'test query',
      project: 'aismr',
      limit: 10,
    });

    expect(valid.success).toBe(true);
  });

  it('should reject invalid memory_search parameters', () => {
    const tool = mcpTools.find((t) => t.name === 'memory_search');
    expect(tool).toBeDefined();

    const schema = tool!.inputSchema as z.ZodObject<any>;
    const invalid = schema.safeParse({
      query: 123, // Should be string
    });

    expect(invalid.success).toBe(false);
  });

  it('should validate workflow_discover parameters', () => {
    const tool = mcpTools.find((t) => t.name === 'workflow_discover');
    expect(tool).toBeDefined();

    const schema = tool!.inputSchema as z.ZodObject<any>;
    const valid = schema.safeParse({
      intent: 'generate ideas',
      project: 'aismr',
    });

    expect(valid.success).toBe(true);
  });

  it('should validate clarify_ask parameters', () => {
    const tool = mcpTools.find((t) => t.name === 'clarify_ask');
    expect(tool).toBeDefined();

    const schema = tool!.inputSchema as z.ZodObject<any>;
    const valid = schema.safeParse({
      question: 'What would you like?',
      suggestedOptions: ['Option 1', 'Option 2'],
    });

    expect(valid.success).toBe(true);
  });
});

