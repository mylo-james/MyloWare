/**
 * MyloWare Notification Utility
 *
 * Easy-to-use notification functions for AI agents to notify completion status.
 */

/**
 * MyloWare Agent Notification Utilities
 *
 * ⚠️ TEMPORARY SOLUTION: This Pushover notification system is a temporary solution
 * until Slack integration is implemented as part of Epic 2: Slack Integration & HITL Framework.
 *
 * Current Status: Pushover notifications for immediate agent communication
 * Future: Will transition to Slack integration for better team collaboration
 * Timeline: Temporary until Epic 2 completion
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface NotificationOptions {
  message: string;
  priority?: 0 | 1 | 2; // 0=normal, 1=high, 2=emergency
  title?: string;
}

export interface NotificationResult {
  success: boolean;
  message: string;
  response?: string;
}

/**
 * Send a notification using the notification script
 */
export function sendNotification(options: NotificationOptions): NotificationResult {
  try {
    const { message, priority = 0, title = 'MyloWare Agent Notification' } = options;

    // Build the command
    const scriptPath = path.join(process.cwd(), 'scripts', 'notify-completion.js');
    const command = `node "${scriptPath}" "${message}" "${priority}" "${title}"`;

    // Execute the notification script
    const output = execSync(command, {
      encoding: 'utf8',
      stdio: 'pipe',
    });

    return {
      success: true,
      message: 'Notification sent successfully',
      response: output,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to send notification: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Send a success notification
 */
export function notifySuccess(message: string, title?: string): NotificationResult {
  return sendNotification({
    message,
    priority: 0,
    title: title || 'MyloWare Success',
  });
}

/**
 * Send a high priority notification (for important completions)
 */
export function notifyImportant(message: string, title?: string): NotificationResult {
  return sendNotification({
    message,
    priority: 1,
    title: title || 'MyloWare Important',
  });
}

/**
 * Send an emergency notification (for errors or critical issues)
 */
export function notifyError(message: string, title?: string): NotificationResult {
  return sendNotification({
    message,
    priority: 2,
    title: title || 'MyloWare Error',
  });
}

/**
 * Send a story completion notification
 */
export function notifyStoryComplete(storyName: string, details?: string): NotificationResult {
  const message = details
    ? `Story ${storyName} completed successfully: ${details}`
    : `Story ${storyName} completed successfully`;

  return sendNotification({
    message,
    priority: 1,
    title: 'MyloWare Story Complete',
  });
}

/**
 * Send a test completion notification
 */
export function notifyTestResults(
  passed: number,
  failed: number,
  coverage?: number
): NotificationResult {
  const message = coverage
    ? `Tests completed: ${passed} passed, ${failed} failed, coverage: ${coverage}%`
    : `Tests completed: ${passed} passed, ${failed} failed`;

  return sendNotification({
    message,
    priority: failed > 0 ? 2 : 0,
    title: 'MyloWare Test Results',
  });
}

/**
 * Send a deployment notification
 */
export function notifyDeployment(
  environment: string,
  version: string,
  success: boolean
): NotificationResult {
  const message = success
    ? `${environment} deployment successful - ${version}`
    : `${environment} deployment failed - ${version}`;

  return sendNotification({
    message,
    priority: success ? 1 : 2,
    title: `MyloWare ${environment} Deployment`,
  });
}

/**
 * Check if notification system is available
 */
export function isNotificationAvailable(): boolean {
  try {
    const scriptPath = path.join(process.cwd(), 'scripts', 'notify-completion.js');
    return fs.existsSync(scriptPath);
  } catch {
    return false;
  }
}
