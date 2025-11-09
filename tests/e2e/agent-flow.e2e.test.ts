import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { searchMemories } from '@/tools/memory/searchTool.js';
import { storeMemory } from '@/tools/memory/storeTool.js';
import { discoverWorkflow } from '@/tools/workflow/discoverTool.js';
import { executeWorkflow } from '@/tools/workflow/executeTool.js';
import { getWorkflowStatus } from '@/tools/workflow/getStatusTool.js';
import { SessionRepository } from '@/db/repositories/session-repository.js';
import { db } from '@/db/client.js';
import { sessions, workflowRuns, memories } from '@/db/schema.js';

describe('Agent E2E Flow', () => {
  beforeAll(async () => {
    // Ensure database is ready
  });

  beforeEach(async () => {
    // Clean up test data
    await db.delete(workflowRuns);
    await db.delete(memories);
    await db.delete(sessions);
  });

  it('should complete idea generation flow', async () => {
    // 1. User message arrives
    const sessionId = 'telegram:test-123';
    
    // 2. Agent loads context
    const sessionRepo = new SessionRepository();
    await sessionRepo.findOrCreate(sessionId, 'mylo', 'chat', 'aismr');
    
    // 3. Agent searches memory
    const pastIdeas = await searchMemories({
      query: 'past AISMR ideas',
      memoryTypes: ['episodic'],
      project: 'aismr',
      limit: 10
    });
    
    expect(pastIdeas.memories).toBeInstanceOf(Array);
    
    // 4. Agent discovers workflow
    const workflows = await discoverWorkflow({
      intent: 'generate video ideas',
      project: 'aismr'
    });
    expect(workflows.workflows.length).toBeGreaterThan(0);
    
    // 5. Agent executes workflow
    const execution = await executeWorkflow({
      workflowId: workflows.workflows[0].workflowId,
      input: { userInput: 'cozy blankets' },
      sessionId
    });
    
    expect(execution.workflowRunId).toBeDefined();
    expect(execution.status).toBe('running');
    
    // 6. Agent stores interaction
    await storeMemory({
      content: `Generated ideas for cozy blankets. Workflow run: ${execution.workflowRunId}`,
      memoryType: 'episodic',
      project: ['aismr'],
      tags: ['workflow-execution']
    });
    
    // 7. Verify workflow run tracked
    const status = await getWorkflowStatus({
      workflowRunId: execution.workflowRunId
    });
    expect(status.status).toBeDefined();
  });
  
  it('should handle workflow discovery with graph expansion', async () => {
    // Store some related memories
    const memory1 = await storeMemory({
      content: 'Workflow for generating AISMR video ideas',
      memoryType: 'procedural',
      project: ['aismr'],
      tags: ['workflow', 'idea-generation']
    });
    
    await storeMemory({
      content: 'Workflow steps for idea generation',
      memoryType: 'procedural',
      project: ['aismr'],
      tags: ['workflow', 'steps'],
      relatedTo: [memory1.id]
    });
    
    // Search with graph expansion
    const results = await searchMemories({
      query: 'generate ideas workflow',
      memoryTypes: ['procedural'],
      project: 'aismr',
      expandGraph: true,
      maxHops: 2,
      limit: 10
    });
    
    expect(results.memories.length).toBeGreaterThan(0);
  });
  
  it('should handle memory search with temporal boost', async () => {
    // Store a recent memory
    await storeMemory({
      content: 'Recent AISMR idea about rain sounds',
      memoryType: 'episodic',
      project: ['aismr'],
      tags: ['recent']
    });
    
    // Search with temporal boost
    const results = await searchMemories({
      query: 'AISMR ideas',
      project: 'aismr',
      temporalBoost: true,
      limit: 10
    });
    
    expect(results.memories.length).toBeGreaterThan(0);
  });
});
