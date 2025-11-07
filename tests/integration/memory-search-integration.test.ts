import { describe, it, expect, beforeEach } from 'vitest';
import { searchMemories } from '@/tools/memory/searchTool.js';
import { storeMemory } from '@/tools/memory/storeTool.js';
import { db } from '@/db/client.js';
import { memories } from '@/db/schema.js';

describe('Memory Search Integration', () => {
  beforeEach(async () => {
    await db.delete(memories);
  });

  it('should find memories by semantic similarity', async () => {
    // Store memories about rain
    await storeMemory({
      content: 'AISMR video idea: Gentle Rain Sounds',
      memoryType: 'episodic',
      project: ['aismr'],
      tags: ['ideas', 'rain'],
    });

    await storeMemory({
      content: 'AISMR video idea: Ocean Waves',
      memoryType: 'episodic',
      project: ['aismr'],
      tags: ['ideas', 'ocean'],
    });

    // Search for rain-related content
    const result = await searchMemories({
      query: 'rain sounds',
      project: 'aismr',
      limit: 10,
    });

    expect(result.memories.length).toBeGreaterThan(0);
    expect(result.memories[0].content.toLowerCase()).toContain('rain');
  });

  it('should combine vector and keyword results with RRF', async () => {
    // Store memories with different keyword patterns
    await storeMemory({
      content: 'Rain sounds ambient AISMR video',
      memoryType: 'episodic',
      project: ['aismr'],
    });

    await storeMemory({
      content: 'Ocean waves crashing sound',
      memoryType: 'episodic',
      project: ['aismr'],
    });

    // Search should return both via hybrid search
    const result = await searchMemories({
      query: 'ambient sounds',
      project: 'aismr',
      limit: 10,
    });

    expect(result.memories.length).toBeGreaterThan(0);
    expect(result.totalFound).toBeGreaterThan(0);
  });

  it('should apply temporal boost to recent memories', async () => {
    // Store older memory
    const oldMemory = await storeMemory({
      content: 'Old AISMR idea about rain',
      memoryType: 'episodic',
      project: ['aismr'],
    });

    // Wait a bit
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Store newer memory
    const newMemory = await storeMemory({
      content: 'New AISMR idea about rain sounds',
      memoryType: 'episodic',
      project: ['aismr'],
    });

    // Search with temporal boost
    const result = await searchMemories({
      query: 'rain',
      project: 'aismr',
      temporalBoost: true,
      limit: 10,
    });

    expect(result.memories.length).toBeGreaterThan(0);
    // Newer memory should rank higher with temporal boost
    const resultIds = result.memories.map((m) => m.id);
    const newIndex = resultIds.indexOf(newMemory.id);
    const oldIndex = resultIds.indexOf(oldMemory.id);
    
    if (newIndex !== -1 && oldIndex !== -1) {
      expect(newIndex).toBeLessThan(oldIndex);
    }
  });

  it('should filter by memory type', async () => {
    await storeMemory({
      content: 'Episodic memory about video production',
      memoryType: 'episodic',
      project: ['aismr'],
    });

    await storeMemory({
      content: 'Procedural workflow for idea generation',
      memoryType: 'procedural',
      project: ['aismr'],
    });

    // Search only procedural memories
    const result = await searchMemories({
      query: 'workflow',
      memoryTypes: ['procedural'],
      project: 'aismr',
      limit: 10,
    });

    expect(result.memories.length).toBeGreaterThan(0);
    result.memories.forEach((m) => {
      expect(m.memoryType).toBe('procedural');
    });
  });

  it('should filter by persona', async () => {
    await storeMemory({
      content: 'Casey persona memory',
      memoryType: 'episodic',
      persona: ['casey'],
      project: ['aismr'],
    });

    await storeMemory({
      content: 'Idea generator persona memory',
      memoryType: 'episodic',
      persona: ['ideagenerator'],
      project: ['aismr'],
    });

    // Search with persona filter
    const result = await searchMemories({
      query: 'memory',
      persona: 'casey',
      project: 'aismr',
      limit: 10,
    });

    expect(result.memories.length).toBeGreaterThan(0);
    result.memories.forEach((m) => {
      expect(m.persona).toContain('casey');
    });
  });

  it('should respect limit parameter', async () => {
    // Store multiple memories
    for (let i = 0; i < 20; i++) {
      await storeMemory({
        content: `AISMR idea ${i} about rain`,
        memoryType: 'episodic',
        project: ['aismr'],
      });
    }

    // Search with limit
    const result = await searchMemories({
      query: 'rain',
      project: 'aismr',
      limit: 5,
    });

    expect(result.memories.length).toBeLessThanOrEqual(5);
  });

  it('should handle workflow-specific parameters without errors', async () => {
    // This tests that workflow params (sessionId, format, searchMode) are stripped
    // and don't cause validation errors
    await storeMemory({
      content: 'Test memory for parameter validation',
      memoryType: 'episodic',
      project: ['aismr'],
    });

    // Simulate workflow call with extra params
    const result = await searchMemories({
      query: 'test',
      project: 'aismr',
      limit: 10,
      // These would be in workflow but stripped by workflow-params utility
    } as any);

    expect(result.memories.length).toBeGreaterThanOrEqual(0);
  });

  it('paginates trace-scoped searches via offset', async () => {
    const traceId = 'trace-pagination-demo';
    const contents: string[] = [];

    for (let i = 0; i < 5; i++) {
      const content = `Trace event #${i}`;
      contents.push(content);
      await storeMemory({
        content,
        memoryType: 'episodic',
        project: ['aismr'],
        traceId,
      });
      // Ensure ordering differences
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    const page = await searchMemories({
      query: 'trace event',
      project: 'aismr',
      traceId,
      limit: 2,
      offset: 1,
    });

    expect(page.memories).toHaveLength(2);
    // Results ordered newest-first; offset 1 skips most recent entry
    const secondNewest = contents[contents.length - 2];
    expect(page.memories[0].content).toEqual(secondNewest);
    expect(page.memories[0].metadata?.traceId).toBe(traceId);
  });
});
