/**
 * Parameter mapping utilities for workflow execution
 * 
 * Workflows may contain parameters that don't match tool schemas directly.
 * This module maps workflow-specific parameters to tool-compatible parameters.
 */

export interface WorkflowParams {
  [key: string]: unknown;
  sessionId?: string;
  format?: 'bullets' | 'narrative' | 'json';
  searchMode?: 'semantic' | 'keyword' | 'hybrid';
  role?: 'user' | 'assistant' | 'system';
  embeddingText?: string;
}

export interface MappedParams {
  toolParams: Record<string, unknown>;
  metadata: {
    sessionId?: string;
    format?: string;
    searchMode?: string;
    role?: string;
    embeddingText?: string;
  };
}

/**
 * Map workflow parameters to tool parameters
 * 
 * Extracts workflow-specific parameters and returns:
 * - toolParams: Parameters safe to pass to MCP tools
 * - metadata: Workflow-specific parameters for post-processing
 */
export function mapWorkflowParams(
  workflowParams: WorkflowParams,
  toolName: string
): MappedParams {
  const {
    sessionId,
    format,
    searchMode,
    role,
    embeddingText,
    ...restParams
  } = workflowParams;

  const toolParams: Record<string, unknown> = { ...restParams };
  const metadata: MappedParams['metadata'] = {};

  // Store workflow-specific params in metadata
  if (sessionId !== undefined) {
    metadata.sessionId = String(sessionId);
  }
  if (format !== undefined) {
    metadata.format = format;
  }
  if (searchMode !== undefined) {
    metadata.searchMode = searchMode;
  }
  if (role !== undefined) {
    metadata.role = role;
  }
  if (embeddingText !== undefined) {
    metadata.embeddingText = String(embeddingText);
  }

  // Tool-specific mappings
  if (toolName === 'memory_search') {
    // sessionId can be used to add persona/project filters if needed
    // For now, we just strip it since tools don't accept it
    
    // searchMode affects search strategy, but tools use temporalBoost/expandGraph instead
    // If searchMode is 'keyword', we might want to disable vector search
    // However, the tool handles hybrid search automatically, so we ignore this
    
    // format is for post-processing results, not a tool parameter
  }

  if (toolName === 'memory_store') {
    // role is not a tool parameter, but might be used in metadata
    // embeddingText is used for generating embeddings, but tool uses content
    
    // If embeddingText is provided, it might override the embedding generation
    // For now, we'll use content for embedding, but store embeddingText in metadata
  }

  return {
    toolParams,
    metadata,
  };
}

/**
 * Strip workflow-specific parameters from params object
 * Returns only parameters that match tool schemas
 */
export function stripWorkflowParams(params: WorkflowParams): Record<string, unknown> {
  const toolParams: Record<string, unknown> = { ...params };
  delete toolParams.sessionId;
  delete toolParams.format;
  delete toolParams.searchMode;
  delete toolParams.role;
  delete toolParams.embeddingText;
  return toolParams;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function tryParseJson<T = unknown>(value: string): T | string {
  try {
    return JSON.parse(value) as T;
  } catch {
    return value;
  }
}

const WRAPPER_KEYS = new Set(['tool', 'response', 'metadata', 'context']);

/**
 * Normalize arbitrary tool params (JSON strings, wrappers, extra metadata)
 */
export function normalizeToolParams(params: unknown): Record<string, unknown> {
  if (params === undefined || params === null) {
    return {};
  }

  let working: unknown = params;

  // If it's a string, try to parse as JSON
  // BUT if it's not valid JSON, don't throw it away - it might be a valid string parameter
  if (typeof working === 'string') {
    const parsed = tryParseJson(working);
    // Only use parsed result if it's actually an object
    // Otherwise keep the original params object (which will be validated by Zod)
    working = typeof parsed === 'object' ? parsed : params;
  }

  if (!isPlainObject(working)) {
    return {};
  }

  // At this point, working is Record<string, unknown>
  let workingObj = working;

  if (isPlainObject(workingObj.arguments)) {
    workingObj = workingObj.arguments;
  }

  if (isPlainObject(workingObj.query)) {
    const otherKeys = Object.keys(workingObj).filter((key) => key !== 'query');
    const canFlatten =
      otherKeys.length === 0 || otherKeys.every((key) => WRAPPER_KEYS.has(key));
    if (canFlatten) {
      workingObj = workingObj.query;
    }
  }

  return stripWorkflowParams(workingObj as WorkflowParams);
}

/**
 * Format search results based on format parameter
 */
export function formatSearchResults(
  results: unknown,
  format?: 'bullets' | 'narrative' | 'json'
): string {
  if (!format || format === 'json') {
    return JSON.stringify(results, null, 2);
  }

  if (format === 'bullets') {
    if (Array.isArray(results)) {
      return results
        .map((item, index) => {
          if (typeof item === 'object' && item !== null) {
            // Try to extract meaningful content
            const itemObj = item as Record<string, unknown>;
            const content = (itemObj.content as string | undefined) || 
                           (itemObj.text as string | undefined) || 
                           JSON.stringify(item);
            return `${index + 1}. ${content}`;
          }
          return `${index + 1}. ${String(item)}`;
        })
        .join('\n');
    }
    return String(results);
  }

  if (format === 'narrative') {
    if (Array.isArray(results)) {
      return results
        .map((item, index) => {
          if (typeof item === 'object' && item !== null) {
            const itemObj = item as Record<string, unknown>;
            const content = (itemObj.content as string | undefined) || 
                           (itemObj.text as string | undefined) || 
                           JSON.stringify(item);
            return `Result ${index + 1}: ${content}`;
          }
          return `Result ${index + 1}: ${String(item)}`;
        })
        .join('\n\n');
    }
    return String(results);
  }

  return JSON.stringify(results);
}
