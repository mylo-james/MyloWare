/**
 * Task Completion Utility
 *
 * Ensures proper notification handling when tasks complete.
 * Provides guardrails to prevent missing success/failure notifications.
 */
export interface TaskResult {
  success: boolean;
  taskName: string;
  duration?: number | undefined;
  details?: string | undefined;
  error?: string | undefined;
}
export interface CompletionOptions {
  notifyOnSuccess?: boolean;
  notifyOnFailure?: boolean;
  customSuccessMessage?: string;
  customFailureMessage?: string;
  includeDetails?: boolean;
}
/**
 * Wraps task execution with automatic completion notifications
 */
export declare function withTaskCompletion<T>(
  taskName: string,
  taskFn: () => Promise<T>,
  options?: CompletionOptions
): Promise<T>;
/**
 * Manually send a success notification
 */
export declare function notifyTaskSuccess(
  taskName: string,
  details?: string,
  customMessage?: string
): Promise<void>;
/**
 * Manually send a failure notification
 */
export declare function notifyTaskFailure(
  taskName: string,
  error: string,
  customMessage?: string
): Promise<void>;
/**
 * Process exit handler that ensures notification on unexpected termination
 */
export declare function setupCompletionGuardrails(taskName: string): () => void;
/**
 * Decorator for automatic task completion notifications
 */
export declare function TaskCompletion(
  taskName?: string,
  options?: CompletionOptions
): (target: any, propertyName: string, descriptor: PropertyDescriptor) => PropertyDescriptor;
//# sourceMappingURL=task-completion.d.ts.map
