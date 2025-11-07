/**
 * Application-wide constants
 *
 * Centralized location for magic numbers and configuration values
 * that are used across multiple modules.
 */

/**
 * Default number of memories to retrieve when no limit is specified
 */
export const DEFAULT_MEMORY_LIMIT = 12;

/**
 * Temporal decay factor for boosting recent memories in search results
 * Higher values = stronger boost for recent items
 */
export const TEMPORAL_DECAY_FACTOR = 0.1;

/**
 * Maximum number of retries for network operations
 */
export const MAX_RETRIES = 3;

/**
 * Session time-to-live in milliseconds (30 minutes)
 */
export const SESSION_TTL_MS = 30 * 60 * 1000;

/**
 * Maximum number of sessions to keep in memory
 */
export const MAX_SESSIONS = 1000;

/**
 * Initial delay for retry operations (milliseconds)
 */
export const RETRY_INITIAL_DELAY_MS = 1000;

/**
 * Maximum delay for retry operations (milliseconds)
 */
export const RETRY_MAX_DELAY_MS = 30000;

/**
 * Backoff multiplier for exponential retry delays
 */
export const RETRY_BACKOFF_MULTIPLIER = 2;
