import { describe, it, expect, beforeEach } from 'vitest';
import { WorkflowExecutor } from './WorkflowExecutor';
import { ExecutionContextBuilder } from './ExecutionContext';
import type { WorkflowDefinition, StepResult } from '../types/workflow';

describe('WorkflowExecutor', () => {
  let executor: WorkflowExecutor;
  let context: ReturnType<typeof ExecutionContextBuilder.create>;

  beforeEach(() => {
    context = ExecutionContextBuilder.create(
      'test-run-id',
      'test-session-id',
      'aismr',
      'Create an ASMR video about puppies',
    );
    executor = new WorkflowExecutor(context);
  });

  describe('loadWorkflow', () => {
    it('should load a valid workflow definition', () => {
      const workflow: WorkflowDefinition = {
        title: 'Test Workflow',
        memoryType: 'procedural',
        project: ['aismr'],
        workflow: {
          name: 'Test',
          description: 'Test workflow',
          steps: [
            {
              id: 'step1',
              step: 1,
              type: 'mcp_call',
              mcp_call: {
                tool: 'prompts.search',
                params: { query: 'test' },
              },
            },
          ],
        },
      };

      expect(() => executor.loadWorkflow(workflow)).not.toThrow();
      expect(executor.getWorkflow()).toEqual(workflow);
    });

    it('should throw on invalid workflow definition', () => {
      const invalidWorkflow = {
        title: 'Test',
        // Missing memoryType
      } as never;

      expect(() => executor.loadWorkflow(invalidWorkflow)).toThrow();
    });

    it('should throw on workflow with circular dependencies', () => {
      const workflow: WorkflowDefinition = {
        title: 'Test',
        memoryType: 'procedural',
        project: ['aismr'],
        workflow: {
          name: 'Test',
          description: 'Test',
          steps: [
            {
              id: 'step1',
              step: 1,
              type: 'mcp_call',
              dependsOn: ['step2'],
              mcp_call: { tool: 'test', params: {} },
            },
            {
              id: 'step2',
              step: 2,
              type: 'mcp_call',
              dependsOn: ['step1'],
              mcp_call: { tool: 'test', params: {} },
            },
          ],
        },
      };

      expect(() => executor.loadWorkflow(workflow)).toThrow('Circular dependency');
    });
  });

  describe('getExecutionOrder', () => {
    it('should return steps in dependency order', () => {
      const workflow: WorkflowDefinition = {
        title: 'Test',
        memoryType: 'procedural',
        project: ['aismr'],
        workflow: {
          name: 'Test',
          description: 'Test',
          steps: [
            {
              id: 'step2',
              step: 2,
              type: 'mcp_call',
              dependsOn: ['step1'],
              mcp_call: { tool: 'test', params: {} },
            },
            {
              id: 'step1',
              step: 1,
              type: 'mcp_call',
              mcp_call: { tool: 'test', params: {} },
            },
          ],
        },
      };

      executor.loadWorkflow(workflow);
      const order = executor.getExecutionOrder();

      expect(order[0].id).toBe('step1');
      expect(order[1].id).toBe('step2');
    });
  });

  describe('getNextStep', () => {
    it('should return next step with no dependencies', () => {
      const workflow: WorkflowDefinition = {
        title: 'Test',
        memoryType: 'procedural',
        project: ['aismr'],
        workflow: {
          name: 'Test',
          description: 'Test',
          steps: [
            {
              id: 'step1',
              step: 1,
              type: 'mcp_call',
              mcp_call: { tool: 'test', params: {} },
            },
          ],
        },
      };

      executor.loadWorkflow(workflow);
      const next = executor.getNextStep([]);

      expect(next?.id).toBe('step1');
    });

    it('should return null when all steps completed', () => {
      const workflow: WorkflowDefinition = {
        title: 'Test',
        memoryType: 'procedural',
        project: ['aismr'],
        workflow: {
          name: 'Test',
          description: 'Test',
          steps: [
            {
              id: 'step1',
              step: 1,
              type: 'mcp_call',
              mcp_call: { tool: 'test', params: {} },
            },
          ],
        },
      };

      executor.loadWorkflow(workflow);
      const next = executor.getNextStep(['step1']);

      expect(next).toBeNull();
    });

    it('should wait for dependencies before returning step', () => {
      const workflow: WorkflowDefinition = {
        title: 'Test',
        memoryType: 'procedural',
        project: ['aismr'],
        workflow: {
          name: 'Test',
          description: 'Test',
          steps: [
            {
              id: 'step1',
              step: 1,
              type: 'mcp_call',
              mcp_call: { tool: 'test', params: {} },
            },
            {
              id: 'step2',
              step: 2,
              type: 'mcp_call',
              dependsOn: ['step1'],
              mcp_call: { tool: 'test', params: {} },
            },
          ],
        },
      };

      executor.loadWorkflow(workflow);

      // Without step1 complete, step2 should not be returned
      const next1 = executor.getNextStep([]);
      expect(next1?.id).toBe('step1');

      // With step1 complete, step2 should be returned
      const next2 = executor.getNextStep(['step1']);
      expect(next2?.id).toBe('step2');
    });
  });

  describe('resolveVariables', () => {
    it('should resolve context variables', () => {
      executor.loadWorkflow({
        title: 'Test',
        memoryType: 'procedural',
        project: ['aismr'],
        workflow: {
          name: 'Test',
          description: 'Test',
          steps: [
            {
              id: 'step1',
              step: 1,
              type: 'mcp_call',
              mcp_call: { tool: 'prompts.search', params: { query: 'test' } },
            },
          ],
        },
      });

      const resolved = executor.resolveVariables('${context.userInput}');
      expect(resolved).toBe('Create an ASMR video about puppies');
    });

    it('should handle multiple variables', () => {
      executor.loadWorkflow({
        title: 'Test',
        memoryType: 'procedural',
        project: ['aismr'],
        workflow: {
          name: 'Test',
          description: 'Test',
          steps: [
            {
              id: 'step1',
              step: 1,
              type: 'mcp_call',
              mcp_call: { tool: 'prompts.search', params: { query: 'test' } },
            },
          ],
        },
      });

      const resolved = executor.resolveVariables(
        'Project: ${context.projectId}, Session: ${context.sessionId}',
      );
      expect(resolved).toBe('Project: aismr, Session: test-session-id');
    });
  });

  describe('getMCPCallParams', () => {
    it('should resolve variables in MCP call parameters', () => {
      const workflow: WorkflowDefinition = {
        title: 'Test',
        memoryType: 'procedural',
        project: ['aismr'],
        workflow: {
          name: 'Test',
          description: 'Test',
          steps: [
            {
              id: 'step1',
              step: 1,
              type: 'mcp_call',
              mcp_call: {
                tool: 'prompts.search',
                params: {
                  query: '${context.userInput}',
                  project: '${context.projectId}',
                },
              },
            },
          ],
        },
      };

      executor.loadWorkflow(workflow);
      const step = executor.getExecutionOrder()[0];
      const params = executor.getMCPCallParams(step);

      expect(params.query).toBe('Create an ASMR video about puppies');
      expect(params.project).toBe('aismr');
    });
  });

  describe('recordStepResult', () => {
    it('should record step execution result', () => {
      const result: StepResult = {
        stepId: 'step1',
        success: true,
        output: { data: 'test' },
      };

      executor.recordStepResult('step1', result);
      const recorded = executor.getStepResult('step1');

      expect(recorded).toEqual(result);
    });
  });

  describe('isComplete', () => {
    it('should return false when workflow not loaded', () => {
      expect(executor.isComplete([])).toBe(false);
    });

    it('should return false when steps incomplete', () => {
      const workflow: WorkflowDefinition = {
        title: 'Test',
        memoryType: 'procedural',
        project: ['aismr'],
        workflow: {
          name: 'Test',
          description: 'Test',
          steps: [
            {
              id: 'step1',
              step: 1,
              type: 'mcp_call',
              mcp_call: { tool: 'test', params: {} },
            },
            {
              id: 'step2',
              step: 2,
              type: 'mcp_call',
              mcp_call: { tool: 'test', params: {} },
            },
          ],
        },
      };

      executor.loadWorkflow(workflow);
      expect(executor.isComplete(['step1'])).toBe(false);
      expect(executor.isComplete(['step1', 'step2'])).toBe(true);
    });
  });
});
