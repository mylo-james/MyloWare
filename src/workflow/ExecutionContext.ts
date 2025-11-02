import type { ExecutionContext as ExecutionContextType } from '../types/workflow';

/**
 * ExecutionContext - Builds and manages execution context for workflows
 */
export class ExecutionContextBuilder {
  /**
   * Create execution context from workflow run and inputs
   */
  static create(
    workflowRunId: string,
    sessionId: string,
    projectId: string,
    userInput: string,
    additionalContext?: Record<string, unknown>,
  ): ExecutionContextType {
    return {
      workflowRunId,
      sessionId,
      projectId,
      userInput,
      stepResults: {},
      ...additionalContext,
    };
  }

  /**
   * Update context with step result
   */
  static updateWithStepResult(
    context: ExecutionContextType,
    stepId: string,
    result: unknown,
  ): ExecutionContextType {
    return {
      ...context,
      stepResults: {
        ...context.stepResults,
        [stepId]: result,
      },
    };
  }

  /**
   * Update context with additional data
   */
  static update(
    context: ExecutionContextType,
    updates: Record<string, unknown>,
  ): ExecutionContextType {
    return {
      ...context,
      ...updates,
    };
  }
}

