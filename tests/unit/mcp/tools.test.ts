import { describe, it, expect, beforeEach } from 'vitest';
import { mcpTools } from '@/mcp/tools.js';
import { db } from '@/db/client.js';
import { memories } from '@/db/schema.js';
import { MemoryRepository } from '@/db/repositories/memory-repository.js';

const getTool = (name: string) => {
  const tool = mcpTools.find((t) => t.name === name);
  if (!tool) {
    throw new Error(`Tool not found: ${name}`);
  }
  return tool;
};

describe('MCP tools', () => {
  beforeEach(async () => {
    await db.delete(memories);
  });

  it('stores and retrieves memories scoped by runId metadata', async () => {
    const memoryStore = getTool('memory_store');
    await memoryStore.handler(
      {
        content: 'Step 1 completed',
        memoryType: 'episodic',
        persona: ['casey'],
        project: ['aismr'],
        tags: ['test'],
        runId: 'run-123',
      },
      'req-memory-store-1'
    );

    await memoryStore.handler(
      {
        content: 'Other run event',
        memoryType: 'episodic',
        runId: 'run-999',
      },
      'req-memory-store-2'
    );

    const memorySearchByRun = getTool('memory_searchByRun');
    const searchResult = await memorySearchByRun.handler(
      { runId: 'run-123' },
      'req-memory-search'
    );

    const result = searchResult.structuredContent as {
      memories: Array<{ metadata: Record<string, unknown> }>;
      totalFound: number;
    };

    expect(result.totalFound).toBe(1);
    expect(result.memories[0].metadata.runId).toBe('run-123');

    const repo = new MemoryRepository();
    const stored = await repo.findByRunId('run-123', {});
    expect(stored).toHaveLength(1);
  });

  describe('memory_store trace filtering and sorting', () => {
    it('filters memory_search results by traceId and sorts newest first', async () => {
      const tool = getTool('memory_store');
      const traceId = '00000000-0000-4000-8000-000000000001';
      const otherTraceId = '00000000-0000-4000-8000-000000000002';

      await tool.handler(
        {
          content: 'Older trace event',
          memoryType: 'episodic',
          traceId,
        },
        'req-memory-store-trace-1'
      );

      await tool.handler(
        {
          content: 'Newer trace event',
          memoryType: 'episodic',
          traceId,
        },
        'req-memory-store-trace-2'
      );

      await tool.handler(
        {
          content: 'Different trace event',
          memoryType: 'episodic',
          traceId: otherTraceId,
        },
        'req-memory-store-trace-3'
      );

      const search = getTool('memory_search');
      const response = await search.handler(
        {
          query: '',
          traceId,
          limit: 10,
        },
        'req-memory-search-trace'
      );

      const result = response.structuredContent as { memories: Array<Record<string, any>> };

      expect(result.memories).toHaveLength(2);
      expect(result.memories[0].content).toBe('Newer trace event');
      expect(result.memories[0].metadata.traceId).toBe(traceId);
      expect(result.memories[1].metadata.traceId).toBe(traceId);
    });
  });
});
