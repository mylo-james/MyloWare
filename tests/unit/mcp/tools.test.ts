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
});
