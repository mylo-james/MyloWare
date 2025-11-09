import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { discoverWorkflow } from '@/tools/workflow/discoverTool.js';
import { executeWorkflow } from '@/tools/workflow/executeTool.js';
import { storeMemory } from '@/tools/memory/storeTool.js';
import { SessionRepository } from '@/db/repositories/session-repository.js';
import { db } from '@/db/client.js';
import { sessions, workflowRuns } from '@/db/schema.js';

describe('Agent Integration', () => {
  beforeAll(async () => {
    // Ensure database is ready
  });

  beforeEach(async () => {
    // Clean up test data
    await db.delete(workflowRuns);
    await db.delete(sessions);
  });

  it('should discover and execute workflow', async () => {
    // Discover workflow
    const discovery = await discoverWorkflow({
      intent: 'generate ideas',
      project: 'aismr',
    });

    expect(discovery.workflows.length).toBeGreaterThan(0);

    // Execute workflow
    const execution = await executeWorkflow({
      workflowId: discovery.workflows[0].workflowId,
      input: { userInput: 'rain sounds' },
      sessionId: 'test-session-123',
    });

    expect(execution.workflowRunId).toBeDefined();
    expect(execution.status).toBe('running');
  });

  it('should manage session context', async () => {
    const repository = new SessionRepository();

    // Create session
    const session = await repository.findOrCreate(
      'test-session-456',
      'test-user',
      'chat',
      'aismr'
    );

    expect(session.id).toBe('test-session-456');
    expect(session.persona).toBe('chat');

    // Update context
    await repository.updateContext('test-session-456', {
      lastIntent: 'generate-ideas',
      recentTopics: ['rain', 'cozy'],
      preferences: { ideaCount: 12 },
    });

    // Retrieve context
    const context = await repository.getContext('test-session-456');
    expect(context.lastIntent).toBe('generate-ideas');
    expect(context.recentTopics).toEqual(['rain', 'cozy']);
  });

  it('should store interaction in memory', async () => {
    const memory = await storeMemory({
      content: 'User asked to generate ideas about rain',
      memoryType: 'episodic',
      project: ['aismr'],
      tags: ['interaction', 'test'],
    });

    expect(memory.id).toBeDefined();
    expect(memory.memoryType).toBe('episodic');
    expect(memory.project).toContain('aismr');
  });

  it('should handle complete agent flow', async () => {
    const repository = new SessionRepository();

    // 1. Create session
    const session = await repository.findOrCreate(
      'telegram:123456',
      'mylo',
      'chat',
      'aismr'
    );

    // 2. Discover workflow
    const discovery = await discoverWorkflow({
      intent: 'generate AISMR video ideas',
      project: 'aismr',
    });

    expect(discovery.workflows.length).toBeGreaterThan(0);

    // 3. Execute workflow
    const execution = await executeWorkflow({
      workflowId: discovery.workflows[0].workflowId,
      input: { userInput: 'cozy blankets' },
      sessionId: session.id,
    });

    // 4. Store interaction
    await storeMemory({
      content: `User requested: generate ideas about cozy blankets. Workflow run: ${execution.workflowRunId}`,
      memoryType: 'episodic',
      project: ['aismr'],
      tags: ['workflow-execution', 'idea-generation'],
      metadata: {
        workflowRunId: execution.workflowRunId,
        sessionId: session.id,
      },
    });

    // 5. Update session context
    await repository.updateContext(session.id, {
      lastIntent: 'generate-ideas',
      lastWorkflowRun: execution.workflowRunId,
      recentTopics: ['cozy blankets'],
    });

    // Verify everything is stored
    const context = await repository.getContext(session.id);
    expect(context.lastWorkflowRun).toBe(execution.workflowRunId);
    expect(context.recentTopics).toContain('cozy blankets');
  });
});
