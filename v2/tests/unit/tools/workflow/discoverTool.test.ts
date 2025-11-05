import { describe, it, expect, beforeEach } from 'vitest';
import { discoverWorkflow } from '@/tools/workflow/discoverTool.js';
import { storeMemory } from '@/tools/memory/storeTool.js';
import { db } from '@/db/client.js';
import { memories } from '@/db/schema.js';

describe('discoverWorkflow', () => {
  beforeEach(async () => {
    // Clear memories
    await db.delete(memories);

    // Add test workflow
    await storeMemory({
      content: 'AISMR Idea Generation Workflow: Generate 12 unique ideas',
      memoryType: 'procedural',
      project: ['aismr'],
      tags: ['workflow', 'idea-generation'],
      metadata: {
        workflow: {
          name: 'Generate Ideas',
          description: 'Generate 12 unique AISMR video ideas',
          steps: [
            {
              id: 'search_past',
              step: 1,
              type: 'mcp_call',
              description: 'Search past ideas',
              mcp_call: {
                tool: 'memory.search',
                params: { query: 'past ideas' },
              },
            },
          ],
        },
      },
    });
  });

  it('should find workflow by intent', async () => {
    const result = await discoverWorkflow({
      intent: 'generate AISMR ideas',
      project: 'aismr',
    });

    expect(result.workflows).toHaveLength(1);
    expect(result.workflows[0].name).toBe('Generate Ideas');
    expect(result.workflows[0].workflow.steps).toBeDefined();
  });

  it('should return empty array when no workflows match', async () => {
    const result = await discoverWorkflow({
      intent: 'unrelated task',
      project: 'unknown',
    });

    expect(result.workflows).toHaveLength(0);
  });

  it('should filter by project', async () => {
    // Add non-AISMR workflow
    await storeMemory({
      content: 'General workflow for testing',
      memoryType: 'procedural',
      project: ['test'],
      tags: ['workflow'],
      metadata: {
        workflow: {
          name: 'Test Workflow',
          description: 'Test workflow',
          steps: [],
        },
      },
    });

    const result = await discoverWorkflow({
      intent: 'workflow',
      project: 'aismr',
    });

    // Should only find AISMR workflow
    expect(result.workflows).toHaveLength(1);
    expect(result.workflows[0].name).toBe('Generate Ideas');
  });
});

