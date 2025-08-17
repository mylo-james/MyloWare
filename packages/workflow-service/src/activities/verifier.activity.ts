/**
 * Verifier Activity
 *
 * Performs final verification and quality assurance on persisted data.
 * This activity validates that the data was correctly stored and meets
 * quality standards.
 */

import { Context, log } from '@temporalio/activity';
import { createLogger } from '@myloware/shared';
import type { VerifierInput, VerifierOutput } from '../types/workflow';

const logger = createLogger('workflow-service:verifier');

export async function verifierActivity(input: VerifierInput): Promise<VerifierOutput> {
  const { workItemId, persistedRecordId, attemptId } = input;

  log.info('Starting Verifier activity', {
    workItemId,
    persistedRecordId,
    attemptId,
    activityId: Context.current().info.activityId,
  });

  try {
    logger.info('Verifying persisted data quality', { workItemId, persistedRecordId, attemptId });

    // Simulate verification process
    // In a real implementation, this would:
    // 1. Retrieve persisted data from database
    // 2. Run quality checks and validation rules
    // 3. Compare against expected data patterns
    // 4. Calculate verification score
    // 5. Identify any issues or anomalies

    const verificationChecks = [
      'Data integrity check',
      'Format validation',
      'Business rule compliance',
      'Completeness verification',
      'Consistency validation',
    ];

    const issues: string[] = [];
    let passedChecks = 0;

    for (const check of verificationChecks) {
      // Heartbeat during verification
      Context.current().heartbeat({
        workItemId,
        currentCheck: check,
        progress: (passedChecks / verificationChecks.length) * 100,
      });

      logger.info('Running verification check', {
        workItemId,
        persistedRecordId,
        check,
      });

      // Simulate verification check with small chance of issues
      if (Math.random() < 0.1) {
        // 10% chance of finding an issue
        issues.push(`${check} failed: Minor data quality issue detected`);
      } else {
        passedChecks++;
      }

      // Small delay to simulate check processing
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    // Calculate verification score (0-100)
    const verificationScore = Math.round((passedChecks / verificationChecks.length) * 100);

    // Simulate potential verifier failures
    if (Math.random() < 0.01) {
      // 1% chance of failure
      throw new Error(
        `Verification failed: Unable to access persisted record ${persistedRecordId}`
      );
    }

    Context.current().heartbeat({
      workItemId,
      status: 'completed',
      verificationScore,
      issuesFound: issues.length,
    });

    const result: VerifierOutput = {
      success: true,
      verificationScore,
      issues: issues.length > 0 ? issues : undefined,
    };

    log.info('Verifier activity completed successfully', {
      workItemId,
      persistedRecordId,
      attemptId,
      verificationScore,
      issuesFound: issues.length,
    });

    logger.info('Data verification completed', {
      workItemId,
      persistedRecordId,
      verificationScore,
      passedChecks,
      totalChecks: verificationChecks.length,
      issues,
    });

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error in Verifier';

    log.error('Verifier activity failed', {
      workItemId,
      persistedRecordId,
      attemptId,
      error: errorMessage,
      activityId: Context.current().info.activityId,
    });

    logger.error('Data verification failed', {
      workItemId,
      persistedRecordId,
      error: errorMessage,
    });

    return {
      success: false,
      verificationScore: 0,
      error: errorMessage,
    };
  }
}
