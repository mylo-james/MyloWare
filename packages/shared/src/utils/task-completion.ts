/**
 * Task Completion Utility
 *
 * Ensures proper notification handling when tasks complete.
 * Provides guardrails to prevent missing success/failure notifications.
 */

import { execSync, execFileSync } from 'child_process';
import { createLogger } from './logger';

const logger = createLogger('task-completion');

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
export async function withTaskCompletion<T>(
  taskName: string,
  taskFn: () => Promise<T>,
  options: CompletionOptions = {}
): Promise<T> {
  const {
    notifyOnSuccess = true,
    notifyOnFailure = true,
    customSuccessMessage,
    customFailureMessage,
    includeDetails = true,
  } = options;

  const startTime = Date.now();

  logger.info('Starting task', { taskName });

  try {
    const result = await taskFn();
    const duration = Date.now() - startTime;

    const taskResult: TaskResult = {
      success: true,
      taskName,
      duration,
      details: includeDetails ? `Task completed in ${duration}ms` : undefined,
    };

    // Send success notification
    if (notifyOnSuccess) {
      await sendCompletionNotification(taskResult, customSuccessMessage);
    }

    logger.info('Task completed successfully', {
      taskName,
      duration,
      notificationSent: notifyOnSuccess,
    });

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    const taskResult: TaskResult = {
      success: false,
      taskName,
      duration,
      error: errorMessage,
      details: includeDetails ? `Task failed after ${duration}ms: ${errorMessage}` : undefined,
    };

    // Send failure notification
    if (notifyOnFailure) {
      await sendCompletionNotification(taskResult, customFailureMessage);
    }

    logger.error('Task failed', {
      taskName,
      duration,
      error: errorMessage,
      notificationSent: notifyOnFailure,
    });

    throw error;
  }
}

/**
 * Send completion notification using the project's notification system
 */
async function sendCompletionNotification(
  result: TaskResult,
  customMessage?: string
): Promise<void> {
  try {
    const message =
      customMessage ||
      (result.success
        ? `✅ ${result.taskName} completed successfully${result.details ? ` - ${result.details}` : ''}`
        : `❌ ${result.taskName} failed${result.error ? ` - ${result.error}` : ''}`);

    const priority = result.success ? '0' : '2'; // 0=normal, 2=emergency
    const title = result.success ? 'MyloWare Task Complete' : 'MyloWare Task Failed';

    // Use the project's notification script
    execFileSync('node', ['scripts/notify-completion.js', message, priority, title], {
      cwd: process.cwd(),
      stdio: 'pipe',
    });

    logger.info('Completion notification sent', {
      taskName: result.taskName,
      success: result.success,
      priority,
    });
  } catch (error) {
    // Don't let notification failures break the main task
    logger.error('Failed to send completion notification', {
      taskName: result.taskName,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Manually send a success notification
 */
export async function notifyTaskSuccess(
  taskName: string,
  details?: string,
  customMessage?: string
): Promise<void> {
  const result: TaskResult = {
    success: true,
    taskName,
    details,
  };

  await sendCompletionNotification(result, customMessage);
}

/**
 * Manually send a failure notification
 */
export async function notifyTaskFailure(
  taskName: string,
  error: string,
  customMessage?: string
): Promise<void> {
  const result: TaskResult = {
    success: false,
    taskName,
    error,
  };

  await sendCompletionNotification(result, customMessage);
}

/**
 * Process exit handler that ensures notification on unexpected termination
 */
export function setupCompletionGuardrails(taskName: string): () => void {
  let taskCompleted = false;

  // Mark task as completed (call this when task finishes normally)
  const markCompleted = () => {
    taskCompleted = true;
  };

  // Cleanup handler for unexpected exit
  const cleanup = async (exitCode: number) => {
    if (!taskCompleted) {
      logger.warn('Task terminated without completion notification', {
        taskName,
        exitCode,
      });

      await notifyTaskFailure(
        taskName,
        `Task terminated unexpectedly with exit code ${exitCode}`,
        `⚠️ ${taskName} terminated unexpectedly`
      );
    }
  };

  // Register exit handlers
  process.on('exit', cleanup);
  process.on('SIGINT', () => {
    cleanup(130).then(() => process.exit(130));
  });
  process.on('SIGTERM', () => {
    cleanup(143).then(() => process.exit(143));
  });
  process.on('uncaughtException', error => {
    notifyTaskFailure(
      taskName,
      error.message,
      `💥 ${taskName} crashed with uncaught exception`
    ).then(() => process.exit(1));
  });

  // Return the completion marker function
  return markCompleted;
}

/**
 * Decorator for automatic task completion notifications
 */
export function TaskCompletion(taskName?: string, options: CompletionOptions = {}) {
  return function (
    target: any,
    propertyName: string,
    descriptor: PropertyDescriptor
  ): PropertyDescriptor {
    const originalMethod = descriptor.value;
    const finalTaskName = taskName || `${target.constructor.name}.${propertyName}`;

    descriptor.value = async function (...args: any[]) {
      return withTaskCompletion(finalTaskName, () => originalMethod.apply(this, args), options);
    };

    return descriptor;
  };
}
