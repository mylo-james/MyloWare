#!/usr/bin/env node

/**
 * Agent Completion Handler
 *
 * Ensures background agents always send completion notifications.
 * Provides guardrails against missing success/failure notifications.
 */

const { execSync } = require('child_process');
const path = require('path');

class AgentCompletionHandler {
  constructor(taskName, options = {}) {
    this.taskName = taskName;
    this.options = {
      notifyOnSuccess: true,
      notifyOnFailure: true,
      autoExit: true,
      ...options,
    };
    this.taskCompleted = false;
    this.startTime = Date.now();

    this.setupGuardrails();
    console.log(`[AGENT] Task started: ${taskName}`);
  }

  /**
   * Mark task as successfully completed
   */
  async markSuccess(details = '', customMessage = '') {
    if (this.taskCompleted) {
      console.warn('[AGENT] Task already marked as completed');
      return;
    }

    this.taskCompleted = true;
    const duration = Date.now() - this.startTime;

    console.log(`[AGENT] Task completed successfully: ${this.taskName} (${duration}ms)`);

    if (this.options.notifyOnSuccess) {
      const message =
        customMessage ||
        `✅ ${this.taskName} completed successfully${details ? ` - ${details}` : ''}`;

      await this.sendNotification(message, '0', 'MyloWare Agent Success');
    }

    if (this.options.autoExit) {
      process.exit(0);
    }
  }

  /**
   * Mark task as failed
   */
  async markFailure(error = 'Unknown error', customMessage = '') {
    if (this.taskCompleted) {
      console.warn('[AGENT] Task already marked as completed');
      return;
    }

    this.taskCompleted = true;
    const duration = Date.now() - this.startTime;

    console.error(`[AGENT] Task failed: ${this.taskName} (${duration}ms) - ${error}`);

    if (this.options.notifyOnFailure) {
      const message = customMessage || `❌ ${this.taskName} failed - ${error}`;

      await this.sendNotification(message, '2', 'MyloWare Agent Failure');
    }

    if (this.options.autoExit) {
      process.exit(1);
    }
  }

  /**
   * Send notification using the project's notification system
   */
  async sendNotification(message, priority = '0', title = 'MyloWare Agent') {
    try {
      const scriptPath = path.join(__dirname, 'notify-completion.js');
      execSync(`node "${scriptPath}" "${message}" ${priority} "${title}"`, {
        stdio: 'inherit',
      });
      console.log('[AGENT] Notification sent successfully');
    } catch (error) {
      console.error('[AGENT] Failed to send notification:', error.message);
    }
  }

  /**
   * Set up guardrails for unexpected termination
   */
  setupGuardrails() {
    const cleanup = async exitCode => {
      if (!this.taskCompleted) {
        console.warn(`[AGENT] Task terminated without completion notification: ${this.taskName}`);
        await this.sendNotification(
          `⚠️ ${this.taskName} terminated unexpectedly (exit code: ${exitCode})`,
          '2',
          'MyloWare Agent Warning'
        );
      }
    };

    // Handle different exit scenarios
    process.on('exit', cleanup);
    process.on('SIGINT', () => {
      cleanup(130).then(() => process.exit(130));
    });
    process.on('SIGTERM', () => {
      cleanup(143).then(() => process.exit(143));
    });
    process.on('uncaughtException', error => {
      console.error('[AGENT] Uncaught exception:', error.message);
      this.sendNotification(
        `💥 ${this.taskName} crashed with uncaught exception: ${error.message}`,
        '2',
        'MyloWare Agent Crash'
      ).then(() => process.exit(1));
    });
    process.on('unhandledRejection', (reason, promise) => {
      console.error('[AGENT] Unhandled rejection:', reason);
      this.sendNotification(
        `💥 ${this.taskName} crashed with unhandled rejection: ${reason}`,
        '2',
        'MyloWare Agent Crash'
      ).then(() => process.exit(1));
    });
  }
}

// Export for use in other scripts
module.exports = AgentCompletionHandler;

// CLI usage example
if (require.main === module) {
  const taskName = process.argv[2] || 'Unknown Task';
  const handler = new AgentCompletionHandler(taskName);

  console.log('[AGENT] Completion handler initialized');
  console.log('[AGENT] Use handler.markSuccess() or handler.markFailure() to complete');

  // Example usage
  setTimeout(async () => {
    await handler.markSuccess('Example task completed', '🎯 Demo task finished!');
  }, 2000);
}
