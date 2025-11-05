import { describe, it, expect } from 'vitest';
import { discoverWorkflow } from '@/tools/workflow/discoverTool.js';

describe('Workflow Discovery Performance', () => {
  it('should complete discovery in < 200ms', async () => {
    const start = Date.now();
    
    await discoverWorkflow({
      intent: 'generate video ideas',
      project: 'aismr'
    });
    
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(200);
  });
  
  it('should handle multiple concurrent discoveries', async () => {
    const discoveries = Array.from({ length: 5 }, (_, i) => 
      discoverWorkflow({
        intent: `test intent ${i}`,
        limit: 5
      })
    );
    
    const start = Date.now();
    await Promise.all(discoveries);
    const duration = Date.now() - start;
    
    // All 5 should complete in < 800ms total
    expect(duration).toBeLessThan(800);
  });
});

