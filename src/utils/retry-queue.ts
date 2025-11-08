import { db } from '../db/client.js';
import { retryQueue } from '../db/schema.js';
import { lt, eq, sql } from 'drizzle-orm';
import { logger } from './logger.js';
import { storeMemory } from '../tools/memory/storeTool.js';
import type { MemoryStoreParams } from '../types/memory.js';
import { retryQueueSize, retryQueueFailures } from './metrics.js';

type RetryQueueItem = typeof retryQueue.$inferSelect;

const PROCESS_INTERVAL_MS = 30000; // 30 seconds
const INITIAL_RETRY_DELAY_MS = 1000; // 1 second
const MAX_RETRY_DELAY_MS = 300000; // 5 minutes

let processingInterval: NodeJS.Timeout | null = null;
let isProcessing = false;

/**
 * Calculate next retry time using exponential backoff
 */
function calculateNextRetry(attempts: number): Date {
  const delayMs = Math.min(
    INITIAL_RETRY_DELAY_MS * Math.pow(2, attempts),
    MAX_RETRY_DELAY_MS
  );
  return new Date(Date.now() + delayMs);
}

/**
 * Enqueue a failed memory operation for retry
 */
export async function enqueueMemoryRetry(
  params: MemoryStoreParams,
  error: Error
): Promise<void> {
  const payload = serializeMemoryStoreParams(params);

  try {
    await db.insert(retryQueue).values({
      task: 'memory_store',
      payload,
      attempts: 0,
      maxAttempts: 5,
      nextRetry: calculateNextRetry(0),
      lastError: error.message,
    });

    logger.info({
      msg: 'Enqueued memory operation for retry',
      task: 'memory_store',
      error: error.message,
    });
  } catch (enqueueError) {
    logger.error({
      msg: 'Failed to enqueue memory retry',
      error: enqueueError instanceof Error ? enqueueError.message : String(enqueueError),
    });
    retryQueueFailures.inc({ task: 'memory_store', reason: 'enqueue_failed' });
  }
}

/**
 * Process a single retry queue item
 */
async function processRetryItem(item: RetryQueueItem): Promise<boolean> {
  try {
    if (item.task === 'memory_store') {
      if (!isMemoryStoreParams(item.payload)) {
        logger.error({
          msg: 'Retry queue payload is invalid for memory_store task, discarding',
          payload: item.payload,
          id: item.id,
        });
        await db.delete(retryQueue).where(eq(retryQueue.id, item.id));
        retryQueueFailures.inc({ task: item.task, reason: 'invalid_payload' });
        return false;
      }

      await storeMemory(item.payload);
      
      // Success - delete the item
      await db.delete(retryQueue).where(eq(retryQueue.id, item.id));
      
      logger.info({
        msg: 'Successfully retried memory operation',
        task: item.task,
        attempts: item.attempts + 1,
        id: item.id,
      });
      
      return true;
    }
    
    logger.warn({
      msg: 'Unknown retry task type',
      task: item.task,
      id: item.id,
    });
    
    return false;
  } catch (error) {
    const newAttempts = item.attempts + 1;
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    if (newAttempts >= item.maxAttempts) {
      // Max attempts reached - delete the item
      await db.delete(retryQueue).where(eq(retryQueue.id, item.id));
      
      logger.error({
        msg: 'Retry queue item exceeded max attempts',
        task: item.task,
        attempts: newAttempts,
        maxAttempts: item.maxAttempts,
        id: item.id,
        lastError: errorMessage,
      });
      
      retryQueueFailures.inc({ task: item.task, reason: 'max_attempts_exceeded' });
      return false;
    }
    
    // Update item with new attempt count and next retry time
    const nextRetryTime = calculateNextRetry(newAttempts);
    await db
      .update(retryQueue)
      .set({
        attempts: newAttempts,
        nextRetry: nextRetryTime,
        lastError: errorMessage,
        updatedAt: new Date(),
      })
      .where(eq(retryQueue.id, item.id));
    
    logger.warn({
      msg: 'Retry attempt failed, will retry again',
      task: item.task,
      attempts: newAttempts,
      maxAttempts: item.maxAttempts,
      id: item.id,
      error: errorMessage,
      nextRetry: nextRetryTime.toISOString(),
    });
    
    return false;
  }
}

/**
 * Process all ready retry queue items
 */
async function processRetryQueue(): Promise<void> {
  if (isProcessing) {
    return; // Skip if already processing
  }
  
  isProcessing = true;
  
  try {
    const now = new Date();
    
    // Load all items ready for retry
    const readyItems = await db
      .select()
      .from(retryQueue)
      .where(lt(retryQueue.nextRetry, now));
    
    if (readyItems.length === 0) {
      return;
    }
    
    logger.debug({
      msg: 'Processing retry queue',
      count: readyItems.length,
    });
    
    // Process items in parallel (with concurrency limit)
    const results = await Promise.allSettled(
      readyItems.map((item) => processRetryItem(item))
    );
    
    const succeeded = results.filter((r) => r.status === 'fulfilled' && r.value).length;
    const failed = results.filter((r) => r.status === 'rejected').length;
    
    logger.info({
      msg: 'Retry queue processing completed',
      total: readyItems.length,
      succeeded,
      failed,
    });
    
    // Update metrics
    const remaining = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(retryQueue);
    
    retryQueueSize.set(Number(remaining[0]?.count) || 0);
  } catch (error) {
    logger.error({
      msg: 'Error processing retry queue',
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    isProcessing = false;
  }
}

/**
 * Start the retry queue processor
 */
export function startRetryQueueProcessor(): void {
  if (processingInterval) {
    logger.warn({ msg: 'Retry queue processor already started' });
    return;
  }
  
  // Load pending retries on startup
  processRetryQueue().catch((error) => {
    logger.error({
      msg: 'Error loading pending retries on startup',
      error: error instanceof Error ? error.message : String(error),
    });
  });
  
  // Process queue every 30 seconds
  processingInterval = setInterval(() => {
    processRetryQueue().catch((error) => {
      logger.error({
        msg: 'Error in retry queue processing interval',
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, PROCESS_INTERVAL_MS);
  
  logger.info({
    msg: 'Retry queue processor started',
    intervalMs: PROCESS_INTERVAL_MS,
  });
}

function serializeMemoryStoreParams(params: MemoryStoreParams): Record<string, unknown> {
  const {
    content,
    memoryType,
    persona,
    project,
    tags,
    relatedTo,
    metadata,
    traceId,
    runId,
    handoffId,
  } = params;

  return {
    content,
    memoryType,
    ...(Array.isArray(persona) ? { persona: [...persona] } : {}),
    ...(Array.isArray(project) ? { project: [...project] } : {}),
    ...(Array.isArray(tags) ? { tags: [...tags] } : {}),
    ...(Array.isArray(relatedTo) ? { relatedTo: [...relatedTo] } : {}),
    ...(metadata ? { metadata } : {}),
    ...(traceId ? { traceId } : {}),
    ...(runId ? { runId } : {}),
    ...(handoffId ? { handoffId } : {}),
  };
}

function isMemoryStoreParams(payload: unknown): payload is MemoryStoreParams {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const record = payload as Record<string, unknown>;
  if (typeof record.content !== 'string') {
    return false;
  }
  if (record.memoryType !== 'episodic' && record.memoryType !== 'semantic' && record.memoryType !== 'procedural') {
    return false;
  }

  return true;
}

/**
 * Stop the retry queue processor
 */
export function stopRetryQueueProcessor(): void {
  if (processingInterval) {
    clearInterval(processingInterval);
    processingInterval = null;
    logger.info({ msg: 'Retry queue processor stopped' });
  }
}

