'use strict';
/**
 * Task Completion Utility
 *
 * Ensures proper notification handling when tasks complete.
 * Provides guardrails to prevent missing success/failure notifications.
 */
Object.defineProperty(exports, '__esModule', { value: true });
exports.withTaskCompletion = withTaskCompletion;
exports.notifyTaskSuccess = notifyTaskSuccess;
exports.notifyTaskFailure = notifyTaskFailure;
exports.setupCompletionGuardrails = setupCompletionGuardrails;
exports.TaskCompletion = TaskCompletion;
const child_process_1 = require('child_process');
const logger_1 = require('./logger');
const logger = (0, logger_1.createLogger)('task-completion');
/**
 * Wraps task execution with automatic completion notifications
 */
async function withTaskCompletion(taskName, taskFn, options = {}) {
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
    const taskResult = {
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
    const taskResult = {
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
async function sendCompletionNotification(result, customMessage) {
  try {
    const message =
      customMessage ||
      (result.success
        ? `✅ ${result.taskName} completed successfully${result.details ? ` - ${result.details}` : ''}`
        : `❌ ${result.taskName} failed${result.error ? ` - ${result.error}` : ''}`);
    const priority = result.success ? '0' : '2'; // 0=normal, 2=emergency
    const title = result.success ? 'MyloWare Task Complete' : 'MyloWare Task Failed';
    // Use the project's notification script
    (0, child_process_1.execFileSync)(
      'node',
      ['scripts/notify-completion.js', message, priority, title],
      {
        cwd: process.cwd(),
        stdio: 'pipe',
      }
    );
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
async function notifyTaskSuccess(taskName, details, customMessage) {
  const result = {
    success: true,
    taskName,
    details,
  };
  await sendCompletionNotification(result, customMessage);
}
/**
 * Manually send a failure notification
 */
async function notifyTaskFailure(taskName, error, customMessage) {
  const result = {
    success: false,
    taskName,
    error,
  };
  await sendCompletionNotification(result, customMessage);
}
/**
 * Process exit handler that ensures notification on unexpected termination
 */
function setupCompletionGuardrails(taskName) {
  let taskCompleted = false;
  // Mark task as completed (call this when task finishes normally)
  const markCompleted = () => {
    taskCompleted = true;
  };
  // Cleanup handler for unexpected exit
  const cleanup = async exitCode => {
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
function TaskCompletion(taskName, options = {}) {
  return function (target, propertyName, descriptor) {
    const originalMethod = descriptor.value;
    const finalTaskName = taskName || `${target.constructor.name}.${propertyName}`;
    descriptor.value = async function (...args) {
      return withTaskCompletion(finalTaskName, () => originalMethod.apply(this, args), options);
    };
    return descriptor;
  };
}
//# sourceMappingURL=task-completion.js.map
