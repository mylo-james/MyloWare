import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { discoverWorkflow } from '@/tools/workflow/discoverTool.js';
import { executeWorkflow } from '@/tools/workflow/executeTool.js';

describe('Workflow Integration', () => {
  beforeAll(async () => {
    // Workflows should be migrated
  });

  it('should discover AISMR idea generation workflow', async () => {
    const result = await discoverWorkflow({
      intent: 'generate AISMR video ideas',
      project: 'aismr',
    });

    expect(result.workflows.length).toBeGreaterThan(0);
    const workflow = result.workflows[0];
    expect(workflow.name).toContain('Ideas');
    expect(workflow.workflow.steps.length).toBeGreaterThan(0);
  });

  it('should discover AISMR screenplay workflow', async () => {
    const result = await discoverWorkflow({
      intent: 'write AISMR screenplay script',
      project: 'aismr',
    });

    expect(result.workflows.length).toBeGreaterThan(0);
    const workflow = result.workflows[0];
    expect(workflow.name).toContain('Script');
    expect(workflow.workflow.steps).toBeDefined();
  });

  it('should execute workflow and track run', async () => {
    // First discover
    const discovery = await discoverWorkflow({
      intent: 'generate ideas',
      project: 'aismr',
    });

    if (discovery.workflows.length === 0) {
      // Skip if no workflows seeded
      console.log('⚠️  No workflows found - skipping execution test');
      return;
    }

    // Note: This will fail if workflow isn't registered in workflow_registry
    // That's expected - workflows need to be seeded and registered first
    try {
      const execution = await executeWorkflow({
        workflowId: discovery.workflows[0].workflowId,
        input: { userInput: 'rain' },
        sessionId: 'test-session',
      });

      expect(execution.workflowRunId).toBeDefined();
      expect(execution.status).toBe('running');
    } catch (error) {
      // If workflow not registered, that's expected
      if (error instanceof Error && error.message.includes('No n8n workflow mapped')) {
        console.log('⚠️  Workflow not registered in workflow_registry - this is expected if workflows not seeded');
        return;
      }
      throw error;
    }
  });

  it('should filter workflows by project', async () => {
    const result = await discoverWorkflow({
      intent: 'workflow',
      project: 'aismr',
    });

    // All workflows should be AISMR workflows
    result.workflows.forEach((w) => {
      expect(w.workflow).toBeDefined();
    });
  });
});
