/**
 * MyloWare Notification Utility
 *
 * Easy-to-use notification functions for AI agents to notify completion status.
 */
export interface NotificationOptions {
  message: string;
  priority?: 0 | 1 | 2;
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
export declare function sendNotification(options: NotificationOptions): NotificationResult;
/**
 * Send a success notification
 */
export declare function notifySuccess(message: string, title?: string): NotificationResult;
/**
 * Send a high priority notification (for important completions)
 */
export declare function notifyImportant(message: string, title?: string): NotificationResult;
/**
 * Send an emergency notification (for errors or critical issues)
 */
export declare function notifyError(message: string, title?: string): NotificationResult;
/**
 * Send a story completion notification
 */
export declare function notifyStoryComplete(
  storyName: string,
  details?: string
): NotificationResult;
/**
 * Send a test completion notification
 */
export declare function notifyTestResults(
  passed: number,
  failed: number,
  coverage?: number
): NotificationResult;
/**
 * Send a deployment notification
 */
export declare function notifyDeployment(
  environment: string,
  version: string,
  success: boolean
): NotificationResult;
/**
 * Check if notification system is available
 */
export declare function isNotificationAvailable(): boolean;
//# sourceMappingURL=notify.d.ts.map
