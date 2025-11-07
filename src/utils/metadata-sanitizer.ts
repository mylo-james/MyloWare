import { logger } from './logger.js';

const RESERVED_KEYS = new Set([
  'traceId',
  'runId',
  'handoffId',
  'sessionId',
  'projectId',
]);

const MAX_METADATA_SIZE_BYTES = 10 * 1024; // 10KB
const MAX_NESTING_DEPTH = 3;

/**
 * Check if a value is a primitive type
 */
function isPrimitive(value: unknown): boolean {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value instanceof Date
  );
}

/**
 * Calculate approximate JSON size in bytes
 */
function calculateJsonSize(obj: unknown): number {
  try {
    return JSON.stringify(obj).length;
  } catch {
    return Infinity;
  }
}

/**
 * Validate and sanitize metadata to prevent reserved key overwrites and enforce size limits
 * 
 * @param metadata - Raw metadata object
 * @returns Sanitized metadata with reserved keys stripped and size validated
 * @throws Error if metadata exceeds size limits or has invalid structure
 */
export function sanitizeMetadata(
  metadata: Record<string, unknown>
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  const strippedKeys: string[] = [];

  // Check total size first
  const totalSize = calculateJsonSize(metadata);
  if (totalSize > MAX_METADATA_SIZE_BYTES) {
    throw new Error(
      `Metadata exceeds maximum size of ${MAX_METADATA_SIZE_BYTES} bytes (got ${totalSize} bytes). Reduce metadata size or split into multiple entries.`
    );
  }

  // Recursively sanitize values
  function sanitizeValue(value: unknown, depth: number): unknown {
    if (depth > MAX_NESTING_DEPTH) {
      throw new Error(
        `Metadata nesting depth exceeds maximum of ${MAX_NESTING_DEPTH} levels`
      );
    }

    if (isPrimitive(value)) {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((item) => sanitizeValue(item, depth + 1));
    }

    if (typeof value === 'object' && value !== null) {
      const sanitizedObj: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value)) {
        sanitizedObj[key] = sanitizeValue(val, depth + 1);
      }
      return sanitizedObj;
    }

    // Unknown type - convert to string
    return String(value);
  }

  // Process each key-value pair
  for (const [key, value] of Object.entries(metadata)) {
    if (RESERVED_KEYS.has(key)) {
      strippedKeys.push(key);
      logger.warn({
        msg: 'Stripped reserved key from metadata',
        key,
        reservedKeys: Array.from(RESERVED_KEYS),
      });
      continue;
    }

    try {
      sanitized[key] = sanitizeValue(value, 0);
    } catch (error) {
      logger.warn({
        msg: 'Failed to sanitize metadata value',
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      // Skip invalid values
      continue;
    }
  }

  if (strippedKeys.length > 0) {
    logger.info({
      msg: 'Sanitized metadata by stripping reserved keys',
      strippedKeys,
      originalSize: Object.keys(metadata).length,
      sanitizedSize: Object.keys(sanitized).length,
    });
  }

  return sanitized;
}

