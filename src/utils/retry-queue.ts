import { db } from '../db/client.js';
import { retryQueue } from '../db/schema.js';
import { lt, eq, sql } from 'drizzle-orm';
import { logger } from './logger.js';
import { storeMemory } from '../tools/memory/storeTool.js';
import type { MemoryStoreParams } from '../types/memory.js';
import { retryQueueSize, retryQueueFailures } from './metrics.js';

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
  try {
    await db.insert(retryQueue).values({
      task: 'memory_store',
      payload: params as Record<string, unknown>,
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
async function processRetryItem(item: {
  id: string;
  task: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
}): Promise<boolean> {
  try {
    if (item.task === 'memory_store') {
      await storeMemory(item.payload as MemoryStoreParams);
      
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
    await db
      .update(retryQueue)
      .set({
        attempts: newAttempts,
        nextRetry: calculateNextRetry(newAttempts),
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
      nextRetry: calculateNextRetry(newAttempts).toISOString(),
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

