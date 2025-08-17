/**
 * Docs Extract & Verify Workflow
 *
 * This workflow orchestrates the document processing pipeline:
 * 1. RecordGen - Generate initial records and context
 * 2. ExtractorLLM - Extract data from documents using LLM
 * 3. JsonRestyler - Transform data to consistent JSON format
 * 4. SchemaGuard - Validate data against schemas
 * 5. Persister - Persist validated data to database
 * 6. Verifier - Perform final verification and quality assurance
 */

import {
  defineSignal,
  defineQuery,
  setHandler,
  condition,
  proxyActivities,
  sleep,
  workflowInfo,
  log,
} from '@temporalio/workflow';
import type {
  WorkOrderInput,
  WorkItemInput,
  WorkflowResult,
  AttemptResult,
  RecordGenInput,
  RecordGenOutput,
  ExtractorLLMInput,
  ExtractorLLMOutput,
  JsonRestylerInput,
  JsonRestylerOutput,
  SchemaGuardInput,
  SchemaGuardOutput,
  PersisterInput,
  PersisterOutput,
  VerifierInput,
  VerifierOutput,
} from '../types/workflow';
import { TEMPORAL_ACTIVITY_OPTIONS } from '../types/workflow';

// Activity imports
import type * as activities from '../activities';

// Proxy activities with configuration
const {
  recordGenActivity,
  extractorLLMActivity,
  jsonRestylerActivity,
  schemaGuardActivity,
  persisterActivity,
  verifierActivity,
} = proxyActivities<typeof activities>(TEMPORAL_ACTIVITY_OPTIONS);

// Workflow signals
export const pauseSignal = defineSignal('pause');
export const resumeSignal = defineSignal('resume');
export const cancelSignal = defineSignal('cancel');

// Workflow queries
export const getStatusQuery = defineQuery<WorkflowResult>('getStatus');
export const getProgressQuery = defineQuery<{ completed: number; total: number; current?: string }>(
  'getProgress'
);

export async function docsExtractVerifyWorkflow(input: WorkOrderInput): Promise<WorkflowResult> {
  const { workOrderId, workItems, priority, metadata } = input;
  const workflowId = workflowInfo().workflowId;

  log.info('Starting Docs Extract & Verify workflow', {
    workOrderId,
    workflowId,
    itemCount: workItems.length,
    priority,
  });

  // Workflow state
  let isPaused = false;
  let isCancelled = false;
  const completedItems: string[] = [];
  const failedItems: string[] = [];
  const attemptResults: AttemptResult[] = [];
  let currentStep = 'INITIALIZING';

  // Signal handlers
  setHandler(pauseSignal, () => {
    isPaused = true;
    log.info('Workflow paused', { workOrderId });
  });

  setHandler(resumeSignal, () => {
    isPaused = false;
    log.info('Workflow resumed', { workOrderId });
  });

  setHandler(cancelSignal, () => {
    isCancelled = true;
    log.info('Workflow cancelled', { workOrderId });
  });

  // Query handlers
  setHandler(
    getStatusQuery,
    (): WorkflowResult => ({
      workOrderId,
      status: isCancelled
        ? 'FAILED'
        : completedItems.length === workItems.length
          ? 'COMPLETED'
          : 'FAILED',
      completedItems,
      failedItems,
      totalAttempts: attemptResults.length,
      totalDuration: Date.now() - workflowInfo().startTime.getTime(),
      errors: attemptResults.filter(a => a.error).map(a => a.error!),
    })
  );

  setHandler(getProgressQuery, () => ({
    completed: completedItems.length,
    total: workItems.length,
    current: currentStep,
  }));

  const startTime = Date.now();

  try {
    // Step 1: Record Generation
    currentStep = 'RECORD_GENERATION';
    log.info('Starting RecordGen activity', { workOrderId, step: currentStep });

    const recordGenResult = await recordGenActivity({
      workOrderId,
      workItems,
    } as RecordGenInput);

    if (!recordGenResult.success) {
      throw new Error(`RecordGen failed: ${recordGenResult.errors?.join(', ')}`);
    }

    log.info('RecordGen completed successfully', {
      workOrderId,
      recordsCreated: recordGenResult.recordsCreated,
    });

    // Process each work item through the pipeline
    for (const workItem of workItems) {
      // Check for pause/cancel signals
      await condition(() => !isPaused && !isCancelled);

      if (isCancelled) {
        log.warn('Workflow cancelled during processing', {
          workOrderId,
          workItemId: workItem.workItemId,
        });
        break;
      }

      const attemptId = `${workItem.workItemId}-${Date.now()}`;

      try {
        // Step 2: LLM Extraction
        currentStep = `EXTRACTION_${workItem.workItemId}`;
        log.info('Starting ExtractorLLM activity', {
          workOrderId,
          workItemId: workItem.workItemId,
        });

        const extractorResult = await extractorLLMActivity({
          workItemId: workItem.workItemId,
          content: workItem.content,
          type: workItem.type,
          attemptId,
        } as ExtractorLLMInput);

        if (!extractorResult.success) {
          throw new Error(`ExtractorLLM failed: ${extractorResult.error}`);
        }

        // Step 3: JSON Restyling
        currentStep = `RESTYLING_${workItem.workItemId}`;
        log.info('Starting JsonRestyler activity', {
          workOrderId,
          workItemId: workItem.workItemId,
        });

        const restylerResult = await jsonRestylerActivity({
          workItemId: workItem.workItemId,
          rawData: extractorResult.extractedData,
          targetSchema: workItem.type.toLowerCase(), // Use type as schema reference
          attemptId,
        } as JsonRestylerInput);

        if (!restylerResult.success) {
          throw new Error(`JsonRestyler failed: ${restylerResult.error}`);
        }

        // Step 4: Schema Validation
        currentStep = `VALIDATION_${workItem.workItemId}`;
        log.info('Starting SchemaGuard activity', { workOrderId, workItemId: workItem.workItemId });

        const guardResult = await schemaGuardActivity({
          workItemId: workItem.workItemId,
          data: restylerResult.styledData,
          schemaId: workItem.type.toLowerCase(),
          attemptId,
        } as SchemaGuardInput);

        if (!guardResult.success) {
          throw new Error(`SchemaGuard failed: ${guardResult.validationErrors?.join(', ')}`);
        }

        // Step 5: Data Persistence
        currentStep = `PERSISTENCE_${workItem.workItemId}`;
        log.info('Starting Persister activity', { workOrderId, workItemId: workItem.workItemId });

        const persisterResult = await persisterActivity({
          workItemId: workItem.workItemId,
          validatedData: guardResult.sanitizedData,
          attemptId,
        } as PersisterInput);

        if (!persisterResult.success) {
          throw new Error(`Persister failed: ${persisterResult.error}`);
        }

        // Step 6: Final Verification
        currentStep = `VERIFICATION_${workItem.workItemId}`;
        log.info('Starting Verifier activity', { workOrderId, workItemId: workItem.workItemId });

        const verifierResult = await verifierActivity({
          workItemId: workItem.workItemId,
          persistedRecordId: persisterResult.persistedRecordId!,
          attemptId,
        } as VerifierInput);

        if (!verifierResult.success) {
          throw new Error(`Verifier failed: ${verifierResult.error}`);
        }

        // Record successful completion
        completedItems.push(workItem.workItemId);
        attemptResults.push({
          attemptId,
          status: 'COMPLETED',
          result: {
            extractedData: extractorResult.extractedData,
            persistedRecordId: persisterResult.persistedRecordId,
            verificationScore: verifierResult.verificationScore,
          },
          startTime: new Date(Date.now()),
          endTime: new Date(),
          metadata: {
            confidence: extractorResult.confidence,
            transformations: restylerResult.transformations,
            verificationScore: verifierResult.verificationScore,
          },
        });

        log.info('Work item completed successfully', {
          workOrderId,
          workItemId: workItem.workItemId,
          verificationScore: verifierResult.verificationScore,
        });
      } catch (error) {
        // Record failed attempt
        failedItems.push(workItem.workItemId);
        attemptResults.push({
          attemptId,
          status: 'FAILED',
          error: error instanceof Error ? error.message : 'Unknown error',
          startTime: new Date(Date.now()),
          endTime: new Date(),
        });

        log.error('Work item failed', {
          workOrderId,
          workItemId: workItem.workItemId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });

        // Continue processing other items even if one fails
        continue;
      }
    }

    const endTime = Date.now();
    const totalDuration = endTime - startTime;

    // Determine final workflow status
    const finalStatus = isCancelled
      ? 'FAILED'
      : failedItems.length === 0
        ? 'COMPLETED'
        : completedItems.length > 0
          ? 'COMPLETED'
          : 'FAILED';

    const result: WorkflowResult = {
      workOrderId,
      status: finalStatus,
      completedItems,
      failedItems,
      totalAttempts: attemptResults.length,
      totalDuration,
      errors: attemptResults.filter(a => a.error).map(a => a.error!),
    };

    log.info('Workflow completed', {
      workOrderId,
      status: finalStatus,
      completedItems: completedItems.length,
      failedItems: failedItems.length,
      totalDuration,
    });

    return result;
  } catch (error) {
    log.error('Workflow failed with unhandled error', {
      workOrderId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return {
      workOrderId,
      status: 'FAILED',
      completedItems,
      failedItems: workItems.map(item => item.workItemId),
      totalAttempts: attemptResults.length,
      totalDuration: Date.now() - startTime,
      errors: [error instanceof Error ? error.message : 'Unknown workflow error'],
    };
  }
}
