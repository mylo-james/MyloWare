'use strict';
/**
 * MyloWare Notification Utility
 *
 * Easy-to-use notification functions for AI agents to notify completion status.
 */
var __createBinding =
  (this && this.__createBinding) ||
  (Object.create
    ? function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        var desc = Object.getOwnPropertyDescriptor(m, k);
        if (!desc || ('get' in desc ? !m.__esModule : desc.writable || desc.configurable)) {
          desc = {
            enumerable: true,
            get: function () {
              return m[k];
            },
          };
        }
        Object.defineProperty(o, k2, desc);
      }
    : function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        o[k2] = m[k];
      });
var __setModuleDefault =
  (this && this.__setModuleDefault) ||
  (Object.create
    ? function (o, v) {
        Object.defineProperty(o, 'default', { enumerable: true, value: v });
      }
    : function (o, v) {
        o['default'] = v;
      });
var __importStar =
  (this && this.__importStar) ||
  (function () {
    var ownKeys = function (o) {
      ownKeys =
        Object.getOwnPropertyNames ||
        function (o) {
          var ar = [];
          for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
          return ar;
        };
      return ownKeys(o);
    };
    return function (mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null)
        for (var k = ownKeys(mod), i = 0; i < k.length; i++)
          if (k[i] !== 'default') __createBinding(result, mod, k[i]);
      __setModuleDefault(result, mod);
      return result;
    };
  })();
Object.defineProperty(exports, '__esModule', { value: true });
exports.sendNotification = sendNotification;
exports.notifySuccess = notifySuccess;
exports.notifyImportant = notifyImportant;
exports.notifyError = notifyError;
exports.notifyStoryComplete = notifyStoryComplete;
exports.notifyTestResults = notifyTestResults;
exports.notifyDeployment = notifyDeployment;
exports.isNotificationAvailable = isNotificationAvailable;
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
const child_process_1 = require('child_process');
const fs = __importStar(require('fs'));
const path = __importStar(require('path'));
/**
 * Send a notification using the notification script
 */
function sendNotification(options) {
  try {
    const { message, priority = 0, title = 'MyloWare Agent Notification' } = options;
    // Build the command
    const scriptPath = path.join(process.cwd(), 'scripts', 'notify-completion.js');
    const command = `node "${scriptPath}" "${message}" "${priority}" "${title}"`;
    // Execute the notification script
    const output = (0, child_process_1.execSync)(command, {
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
function notifySuccess(message, title) {
  return sendNotification({
    message,
    priority: 0,
    title: title || 'MyloWare Success',
  });
}
/**
 * Send a high priority notification (for important completions)
 */
function notifyImportant(message, title) {
  return sendNotification({
    message,
    priority: 1,
    title: title || 'MyloWare Important',
  });
}
/**
 * Send an emergency notification (for errors or critical issues)
 */
function notifyError(message, title) {
  return sendNotification({
    message,
    priority: 2,
    title: title || 'MyloWare Error',
  });
}
/**
 * Send a story completion notification
 */
function notifyStoryComplete(storyName, details) {
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
function notifyTestResults(passed, failed, coverage) {
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
function notifyDeployment(environment, version, success) {
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
function isNotificationAvailable() {
  try {
    const scriptPath = path.join(process.cwd(), 'scripts', 'notify-completion.js');
    return fs.existsSync(scriptPath);
  } catch {
    return false;
  }
}
//# sourceMappingURL=notify.js.map
