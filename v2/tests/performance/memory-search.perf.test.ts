import { describe, it, expect } from 'vitest';
import { searchMemories } from '@/tools/memory/searchTool.js';

describe('Memory Search Performance', () => {
  it('should complete vector search in < 100ms', async () => {
    const start = Date.now();
    
    await searchMemories({
      query: 'generate AISMR ideas',
      project: 'aismr',
      limit: 10
    });
    
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(100);
  });
  
  it('should complete keyword search in < 50ms', async () => {
    const start = Date.now();
    
    await searchMemories({
      query: 'AISMR screenplay',
      memoryTypes: ['procedural'],
      limit: 10
    });
    
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(50);
  });
  
  it('should handle 10 concurrent searches', async () => {
    const searches = Array.from({ length: 10 }, (_, i) => 
      searchMemories({
        query: `test query ${i}`,
        limit: 5
      })
    );
    
    const start = Date.now();
    await Promise.all(searches);
    const duration = Date.now() - start;
    
    // All 10 should complete in < 500ms total
    expect(duration).toBeLessThan(500);
  });
  
  it('should complete graph expansion search in < 200ms', async () => {
    const start = Date.now();
    
    await searchMemories({
      query: 'test query',
      expandGraph: true,
      maxHops: 2,
      limit: 10
    });
    
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(200);
  });
  
  it('should complete filtered search with minSimilarity in < 100ms', async () => {
    const start = Date.now();
    
    await searchMemories({
      query: 'test query',
      minSimilarity: 0.7,
      limit: 10
    });
    
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(100);
  });
});

