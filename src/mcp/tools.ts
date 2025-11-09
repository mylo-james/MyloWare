import { z } from 'zod';
import { searchMemories } from '../tools/memory/searchTool.js';
import { storeMemory } from '../tools/memory/storeTool.js';
import { MemoryRepository, TraceRepository, VideoJobsRepository, EditJobsRepository, ProjectRepository, WorkflowMappingRepository } from '../db/repositories/index.js';
import type { Trace } from '../db/repositories/trace-repository.js';
import { logger, sanitizeParams } from '../utils/logger.js';
import { stripEmbeddings } from '../utils/response-formatter.js';
import { prepareTraceContext, type TracePrepParams } from '../utils/trace-prep.js';
import { randomUUID } from 'crypto';
import { config } from '../config/index.js';
import { N8nClient } from '../integrations/n8n/client.js';
import { withRetry } from '../utils/retry.js';
import { db } from '../db/client.js';
import { executionTraces } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { getTelegramClient } from '../integrations/telegram/client.js';
import { enqueueMemoryRetry } from '../utils/retry-queue.js';
import { sanitizeMetadata } from '../utils/metadata-sanitizer.js';
import { MCPError, MCPErrorCode, NotFoundError, ValidationError } from '../utils/errors.js';

export interface MCPTool {
  name: string;
  title: string;
  description: string;
  inputSchema: z.AnyZodObject;
  outputSchema?: z.AnyZodObject;
  handler: (params: unknown, requestId: string) => Promise<{
    content: Array<{ type: 'text'; text: string }>;
    structuredContent?: unknown;
    isError?: boolean;
  }>;
}

/**
 * Unwrap common parameter wrappers from n8n workflow calls
 * Handles: JSON strings, arguments wrapper, query wrapper
 */
function unwrapParams(params: unknown): unknown {
  if (params === undefined || params === null) {
    return {};
  }

  let working: unknown = params;

  // If it's a string, try to parse as JSON
  if (typeof working === 'string') {
    try {
      working = JSON.parse(working);
    } catch {
      // If not valid JSON, return as-is (will be handled by field-level parsers)
      return params;
    }
  }

  if (typeof working !== 'object' || working === null || Array.isArray(working)) {
    return params;
  }

  const workingObj = working as Record<string, unknown>;

  // Unwrap arguments wrapper
  if (typeof workingObj.arguments === 'object' && workingObj.arguments !== null && !Array.isArray(workingObj.arguments)) {
    return workingObj.arguments;
  }

  // Flatten query wrapper if it's the only meaningful key
  const WRAPPER_KEYS = new Set(['tool', 'response', 'metadata', 'context']);
  if (typeof workingObj.query === 'object' && workingObj.query !== null && !Array.isArray(workingObj.query)) {
    const otherKeys = Object.keys(workingObj).filter(key => key !== 'query');
    const canFlatten = otherKeys.length === 0 || otherKeys.every(key => WRAPPER_KEYS.has(key));
    if (canFlatten) {
      return workingObj.query;
    }
  }

  // Strip workflow-specific parameters that aren't part of tool schemas
  const toolParams = { ...workingObj };
  delete (toolParams as Record<string, unknown>).format;
  delete (toolParams as Record<string, unknown>).searchMode;
  delete (toolParams as Record<string, unknown>).role;
  delete (toolParams as Record<string, unknown>).embeddingText;
  return toolParams;
}

// Zod preprocessors for flexible parameter parsing
const numberLike = () =>
  z.preprocess(
    (val) => {
      if (typeof val === 'number') return val;
      if (typeof val === 'string') {
        const trimmed = val.trim();
        if (!trimmed) throw new Error('Number value cannot be empty');
        const parsed = Number(trimmed);
        if (Number.isNaN(parsed)) throw new Error(`Invalid number: ${val}`);
        return parsed;
      }
      throw new Error(`Expected number or numeric string, got ${typeof val}`);
    },
    z.number()
  );

const booleanLike = () =>
  z.preprocess(
    (val) => {
      if (typeof val === 'boolean') return val;
      if (typeof val === 'number') {
        if (val === 1) return true;
        if (val === 0) return false;
        throw new Error(`Invalid boolean number: ${val}`);
      }
      if (typeof val === 'string') {
        const normalized = val.trim().toLowerCase();
        if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
        if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
        throw new Error(`Invalid boolean string: ${val}`);
      }
      throw new Error(`Expected boolean, got ${typeof val}`);
    },
    z.boolean()
  );

const stringArrayLike = () =>
  z.preprocess(
    (val) => {
      if (Array.isArray(val)) return val.map(String);
      if (typeof val === 'string') {
        const trimmed = val.trim();
        if (!trimmed) return [];
        if (trimmed.startsWith('[')) {
          try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) return parsed.map(String);
          } catch {
            // Fall through to comma parsing
          }
        }
        return trimmed.split(',').map(s => s.trim()).filter(Boolean);
      }
      return [];
    },
    z.array(z.string())
  );

const recordLike = () =>
  z.preprocess(
    (val) => {
      if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
        return val;
      }
      if (typeof val === 'string') {
        const trimmed = val.trim();
        if (!trimmed) return {};
        try {
          const parsed = JSON.parse(trimmed);
          if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            return parsed;
          }
          return { value: parsed };
        } catch {
          return { value: trimmed };
        }
      }
      return {};
    },
    z.record(z.unknown())
  );

const memorySearchInputSchema = z.object({
  query: z.string().max(10000, 'Query must be 10000 characters or less'),
  memoryTypes: z.array(z.enum(['episodic', 'semantic', 'procedural'])).optional(),
  project: z.string().optional(),
  persona: z.string().optional(),
  traceId: z.string().optional(),
  limit: numberLike().optional(),
  offset: numberLike().optional(),
  minSimilarity: numberLike().optional(),
  temporalBoost: booleanLike().optional(),
  expandGraph: booleanLike().optional(),
  maxHops: numberLike().optional(),
});

const memoryStoreInputSchema = z.object({
  content: z.string().max(50000, 'Content must be 50000 characters or less'),
  memoryType: z.enum(['episodic', 'semantic', 'procedural']),
  persona: stringArrayLike().optional(),
  project: stringArrayLike().optional(),
  tags: stringArrayLike().optional(),
  metadata: recordLike().optional(),
  relatedTo: stringArrayLike().optional(),
  traceId: z.string().optional(),
  runId: z.string().optional(),
  handoffId: z.string().optional(),
});

const jobStatusValues = ['queued', 'running', 'succeeded', 'failed', 'canceled'] as const;

// UUID validation helper
const uuidSchema = z.string().uuid('traceId must be a valid UUID');

const traceUpdateInputSchema = z.object({
  traceId: uuidSchema,
  projectId: uuidSchema.optional(),
  instructions: z.string().max(10000, 'Instructions must be 10000 characters or less').optional(),
  metadata: recordLike().optional(),
});

const tracePrepareInputSchema = z.object({
  traceId: z.string().uuid('traceId must be a valid UUID').optional(),
  instructions: z.string().max(10000, 'Instructions must be 10000 characters or less').optional(),
  sessionId: z.string().optional(),
  source: z.string().optional(),
  metadata: recordLike().optional(),
  memoryLimit: numberLike().optional(),
});

// Trace coordination schemas
const handoffToAgentInputSchema = z.object({
  traceId: uuidSchema,
  toAgent: z.string(),
  instructions: z.string().max(10000, 'Instructions must be 10000 characters or less'),
  metadata: recordLike().optional(),
});

// Memory tools
const memorySearchTool: MCPTool = {
  name: 'memory_search',
  title: 'Search Memories',
  description: 'Search memories via hybrid vector + keyword search. **REQUIRED**: Always include traceId parameter from your system prompt (TRACE ID field). Example: memory_search({traceId: "trace-aismr-001", query: "modifiers", limit: 10}). When traceId is provided, returns newest-first results from that trace. Do NOT create or invent a traceId - use the exact traceId from your system prompt.',
  inputSchema: memorySearchInputSchema,
  handler: async (params, requestId) => {
    const unwrapped = unwrapParams(params);
    const validated = memorySearchInputSchema.parse(unwrapped);

    logger.info({
      msg: 'MCP tool called',
      tool: 'memory_search',
      params: sanitizeParams(validated),
      requestId,
    });

    const result = await searchMemories(validated);
    // Strip embeddings from response to reduce payload size
    const cleanResult = stripEmbeddings(result);
    return {
      content: [{ type: 'text', text: JSON.stringify(cleanResult) }],
      structuredContent: cleanResult,
    };
  },
};

const memoryStoreTool: MCPTool = {
  name: 'memory_store',
  title: 'Store Memory',
  description: 'Store a single-line memory entry. **REQUIRED**: Always include traceId parameter from your system prompt (TRACE ID field). Example: memory_store({content: "Generated 12 modifiers", memoryType: "episodic", persona: ["iggy"], project: ["aismr"], traceId: "trace-aismr-001"}). Array fields (persona, project, tags, relatedTo) must always be JSON arrays, even for a single value. Do NOT create or invent a traceId - use the exact traceId from your system prompt.',
  inputSchema: memoryStoreInputSchema,
  handler: async (params, requestId) => {
    const unwrapped = unwrapParams(params);
    const validated = memoryStoreInputSchema.parse(unwrapped);

    logger.info({
      msg: 'MCP tool called',
      tool: 'memory_store',
      params: sanitizeParams(validated),
      requestId,
    });

    const { traceId, runId, handoffId, relatedTo, ...rest } = validated;
    // Sanitize user-provided metadata before merging with reserved keys
    const sanitizedUserMetadata = rest.metadata
      ? sanitizeMetadata(rest.metadata as Record<string, unknown>)
      : {};
    const metadata = {
      ...sanitizedUserMetadata,
      ...(traceId ? { traceId } : {}),
      ...(runId ? { runId } : {}),
      ...(handoffId ? { handoffId } : {}),
    };

    const result = await storeMemory({
      ...rest,
      metadata,
      relatedTo,
    });
    // Strip embedding from response
    const cleanResult = stripEmbeddings(result);
    return {
      content: [{ type: 'text', text: JSON.stringify(cleanResult) }],
      structuredContent: cleanResult,
    };
  },
};

// Trace coordination tools
const tracePrepareTool: MCPTool = {
  name: 'trace_prepare',
  title: 'Prepare Trace Context',
  description: 'Create-or-load the active trace, build the persona/project prompt, and return the scoped MCP tool list',
  inputSchema: tracePrepareInputSchema,
  handler: async (params, requestId) => {
    const unwrapped = unwrapParams(params);
    const validated = tracePrepareInputSchema.parse(unwrapped);

    logger.info({
      msg: 'MCP tool called',
      tool: 'trace_prepare',
      params: sanitizeParams({ ...validated, instructions: validated.instructions ? '[redacted]' : undefined }),
      requestId,
    });

    // Prepare trace context using shared utility
    const tracePrepParams: TracePrepParams = {
      traceId: validated.traceId,
        instructions: validated.instructions,
      sessionId: validated.sessionId,
      source: validated.source,
      metadata: validated.metadata,
      memoryLimit: validated.memoryLimit,
    };

    const responsePayload = await prepareTraceContext(tracePrepParams);

    return {
      content: [{ type: 'text', text: JSON.stringify(responsePayload) }],
      structuredContent: responsePayload,
    };
  },
};


const traceUpdateTool: MCPTool = {
  name: 'trace_update',
  title: 'Update Trace',
  description: 'Update project, instructions, or metadata for an existing trace. **REQUIRED**: traceId parameter MUST come from your system prompt (TRACE ID field). **IMPORTANT**: projectId should be a canonical project UUID. For backward compatibility, project slugs (e.g., "aismr") are accepted but will be resolved to UUIDs. Example: trace_update({traceId: "trace-aismr-001", projectId: "550e8400-e29b-41d4-a716-446655440000", instructions: "..."}). Do NOT create or invent a traceId - use the exact traceId from your system prompt. Typically called by Casey after normalizing the request.',
  inputSchema: traceUpdateInputSchema,
  handler: async (params, requestId) => {
    const unwrapped = unwrapParams(params);
    const validated = traceUpdateInputSchema.parse(unwrapped);

    logger.info({
      msg: 'MCP tool called',
      tool: 'trace_update',
      params: sanitizeParams(validated),
      requestId,
    });

    const updatePayload: Record<string, unknown> = {};
    if (typeof validated.projectId !== 'undefined') {
      // Validate project exists
      const projectRepo = new ProjectRepository();
      const project = await projectRepo.findById(validated.projectId);
      if (!project) {
        throw new Error(
          `Project not found: "${validated.projectId}". Provide a valid project UUID from the available projects list.`
        );
      }
      updatePayload.projectId = project.id;
    }
    if (typeof validated.instructions !== 'undefined') {
      updatePayload.instructions = validated.instructions;
    }
    if (typeof validated.metadata !== 'undefined') {
      updatePayload.metadata = sanitizeMetadata(validated.metadata as Record<string, unknown>);
    }

    if (Object.keys(updatePayload).length === 0) {
      throw new Error('trace_update requires at least one field: projectId, instructions, or metadata');
    }

    const traceRepo = new TraceRepository();
    const updatedTrace = await traceRepo.updateTrace(validated.traceId, updatePayload);
    if (!updatedTrace) {
      throw new NotFoundError(`Trace not found: ${validated.traceId}`, 'trace', MCPErrorCode.TRACE_NOT_FOUND);
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(updatedTrace) }],
      structuredContent: updatedTrace,
    };
  },
};

const handoffToAgentTool: MCPTool = {
  name: 'handoff_to_agent',
  title: 'Handoff to Agent',
  description: '**REQUIRED**: You MUST call this tool to hand off work to another agent. Simply storing a memory about handoff is NOT sufficient. **CRITICAL**: traceId parameter MUST come from your system prompt (TRACE ID field). Example: handoff_to_agent({traceId: "trace-aismr-001", toAgent: "iggy", instructions: "Generate 12 modifiers..."}). Do NOT create or invent a traceId - use the exact traceId from your system prompt. Parameters: traceId (UUID from system prompt TRACE ID field), toAgent (persona name like "iggy", "riley", "veo", "alex", "quinn", or "complete"/"error"), instructions (briefing for next agent).',
  inputSchema: handoffToAgentInputSchema,
  handler: async (params, requestId) => {
    const unwrapped = unwrapParams(params);
    const validated = handoffToAgentInputSchema.parse(unwrapped);

    logger.info({
      msg: 'MCP tool called',
      tool: 'handoff_to_agent',
      params: sanitizeParams(validated),
      requestId,
    });

    const traceRepo = new TraceRepository();

    const targetAgent = validated.toAgent.trim().toLowerCase();
    const isTerminalTarget = targetAgent === 'complete' || targetAgent === 'error';

    // Validate trace exists and is active
    const trace = await traceRepo.findByTraceId(validated.traceId);
    if (!trace) {
      throw new Error(`Trace not found: ${validated.traceId}`);
    }
    if (trace.status !== 'active') {
      throw new Error(`Trace is not active (status: ${trace.status})`);
    }

    const currentWorkflowStep = typeof trace.workflowStep === 'number' ? trace.workflowStep : 0;

    if (isTerminalTarget) {
      // Update trace and status atomically with optimistic locking and retry logic
      const expectedCurrentOwner = trace.currentOwner;
      const status = targetAgent === 'complete' ? 'completed' : 'failed';
      const updatedTrace = await withRetry(
        async () => {
          // Use transaction to ensure atomicity of trace update and status update
          return await db.transaction(async (tx) => {
            // Update trace with optimistic locking check
            const current = await traceRepo.findByTraceId(validated.traceId);
            if (!current) {
              throw new Error(`Trace not found: ${validated.traceId}`);
            }
            if (expectedCurrentOwner !== undefined && current.currentOwner !== expectedCurrentOwner) {
              throw new Error(
                `Trace ownership conflict: expected owner '${expectedCurrentOwner}', but current owner is '${current.currentOwner}'`
              );
            }

            // Update trace ownership and workflow step
            const [traceResult] = await tx
              .update(executionTraces)
              .set({
                previousOwner: current.currentOwner,
                currentOwner: targetAgent,
                instructions: validated.instructions,
                workflowStep: currentWorkflowStep + 1,
                status,
                completedAt: status === 'completed' ? new Date() : null,
              })
              .where(eq(executionTraces.traceId, validated.traceId))
              .returning();

            if (!traceResult) {
        throw new Error(`Failed to update trace ownership for ${validated.traceId}`);
      }

            return traceResult as Trace;
          });
        },
        {
          maxRetries: 3,
          initialDelay: 100,
          maxDelay: 1000,
          backoff: 'exponential',
          retryable: (error) => {
            // Retry on ownership conflicts
            return error instanceof Error && error.message.includes('Trace ownership conflict');
          },
        }
      );

      try {
        await storeMemory({
          content: `Trace ${status} via ${targetAgent} handoff: ${validated.instructions}`,
          memoryType: 'episodic',
          tags: ['handoff', targetAgent, status],
          metadata: {
            traceId: validated.traceId,
            toAgent: targetAgent,
            status,
            instructions: validated.instructions,
            ...(validated.metadata
              ? sanitizeMetadata(validated.metadata as Record<string, unknown>)
              : {}),
          },
        });
      } catch (memoryError) {
        const error = memoryError instanceof Error ? memoryError : new Error(String(memoryError));
        logger.warn({
          msg: 'Failed to store terminal handoff memory, enqueueing for retry',
          error: error.message,
          requestId,
        });
        // Enqueue for retry instead of just logging
        await enqueueMemoryRetry(
          {
            content: `Trace ${status} via ${targetAgent} handoff: ${validated.instructions}`,
            memoryType: 'episodic',
            tags: ['handoff', targetAgent, status],
            metadata: {
              traceId: validated.traceId,
              toAgent: targetAgent,
              status,
              instructions: validated.instructions,
              ...(validated.metadata || {}),
            },
          },
          error
        );
      }

      // Send Telegram notification when workflow completes
      if (status === 'completed' && targetAgent === 'complete' && updatedTrace.sessionId) {
        try {
          const sessionId = updatedTrace.sessionId;
          // Extract user ID from sessionId if it's a Telegram session
          if (sessionId.startsWith('telegram:')) {
            const userId = sessionId.replace('telegram:', '');
            
            // Extract publish URL from instructions or trace outputs
            let publishUrl = '';
            const urlMatch = validated.instructions.match(/URL:\s*(https?:\/\/[^\s]+)/i);
            if (urlMatch) {
              publishUrl = urlMatch[1];
            } else if (updatedTrace.outputs && typeof updatedTrace.outputs === 'object' && 'url' in updatedTrace.outputs) {
              publishUrl = String(updatedTrace.outputs.url);
            }

            // Resolve project display name
            let projectName = 'video';
            if (updatedTrace.projectId) {
              try {
                const projectRepo = new ProjectRepository();
                const projectRecord = await projectRepo.findById(updatedTrace.projectId);
                if (projectRecord) {
                  projectName = projectRecord.name.toUpperCase();
                }
              } catch (projectLookupError) {
                logger.warn({
                  msg: 'Failed to resolve project name for completion notification',
                  traceId: validated.traceId,
                  error:
                    projectLookupError instanceof Error
                      ? projectLookupError.message
                      : String(projectLookupError),
                  requestId,
                });
              }
            }

            // Build notification message
            const message = publishUrl
              ? `✅ Your ${projectName} video is live!\n\nWatch: ${publishUrl}`
              : `✅ Your ${projectName} video is live!\n\n${validated.instructions}`;

            // Send notification (errors are logged but don't fail handoff)
            const telegramClient = getTelegramClient();
            if (telegramClient) {
              await telegramClient.sendMessage(userId, message);
              logger.info({
                msg: 'Sent completion notification to user',
                traceId: validated.traceId,
                userId,
                requestId,
              });
            } else {
              logger.debug({
                msg: 'Telegram client not available, skipping notification',
                traceId: validated.traceId,
                requestId,
              });
            }
          }
        } catch (notificationError) {
          // Log but don't fail handoff if notification fails
          logger.warn({
            msg: 'Failed to send completion notification',
            traceId: validated.traceId,
            error: notificationError instanceof Error ? notificationError.message : String(notificationError),
            requestId,
          });
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              traceId: validated.traceId,
              status,
              toAgent: targetAgent,
            }),
          },
        ],
        structuredContent: {
          traceId: validated.traceId,
          status,
          toAgent: targetAgent,
        },
      };
    }

    // Universal workflow: All agents use the same webhook path
    // The workflow determines which persona to use based on trace.currentOwner via trace_prep
    // n8n webhooks: /webhook/<path> for production (active workflows), /webhook-test/<path> for testing
    const webhookUrl = `${config.n8n.webhookUrl}/webhook/myloware/ingest`;

    // Update trace and store memory atomically with optimistic locking and retry logic
    const expectedCurrentOwner = trace.currentOwner;
    await withRetry(
      async () => {
        // Use transaction to ensure atomicity of trace update and memory storage
        return await db.transaction(async (tx) => {
          // Update trace with optimistic locking check
          const current = await traceRepo.findByTraceId(validated.traceId);
          if (!current) {
            throw new Error(`Trace not found: ${validated.traceId}`);
    }
          if (expectedCurrentOwner !== undefined && current.currentOwner !== expectedCurrentOwner) {
            throw new Error(
              `Trace ownership conflict: expected owner '${expectedCurrentOwner}', but current owner is '${current.currentOwner}'`
            );
          }

          // Update trace
          const [traceResult] = await tx
            .update(executionTraces)
            .set({
              previousOwner: current.currentOwner,
              currentOwner: targetAgent,
              instructions: validated.instructions,
              workflowStep: currentWorkflowStep + 1,
            })
            .where(eq(executionTraces.traceId, validated.traceId))
            .returning();

          if (!traceResult) {
      throw new Error(`Failed to update trace ownership for ${validated.traceId}`);
    }

          // Store handoff memory (basic insert, embedding will be generated asynchronously if needed)
          // For now, we'll store it outside the transaction since storeMemory does embedding generation
          // The atomicity is ensured by the trace update succeeding before we proceed
          
          return traceResult as Trace;
        });
      },
      {
        maxRetries: 3,
        initialDelay: 100,
        maxDelay: 1000,
        backoff: 'exponential',
        retryable: (error) => {
          // Retry on ownership conflicts
          return error instanceof Error && error.message.includes('Trace ownership conflict');
        },
      }
    );

    // Build payload
    const payload = {
      traceId: validated.traceId,
      instructions: validated.instructions,
      metadata: validated.metadata || {},
      projectId: trace.projectId,
      sessionId: trace.sessionId,
    };

    // Invoke webhook (outside transaction to avoid holding it open)
    const n8nClient = new N8nClient({
      baseUrl: config.n8n.baseUrl || 'http://n8n:5678',
      apiKey: config.n8n.apiKey,
    });

    const webhookResponse = await n8nClient.invokeWebhook(webhookUrl, payload, {
      method: 'POST',
      authType: 'none',
      authConfig: {},
      authToken: config.n8n.webhookAuthToken,
      authHeaderName: config.n8n.webhookHeaderName,
      timeoutMs: 30000, // Default 30 second timeout
    });

    // Store handoff event to memory (after transaction commits and webhook succeeds)
    try {
      await storeMemory({
        content: `Handed off to ${validated.toAgent}: ${validated.instructions}`,
        memoryType: 'episodic',
        tags: ['handoff', validated.toAgent],
        metadata: {
          traceId: validated.traceId,
          toAgent: validated.toAgent,
          executionId: webhookResponse.executionId,
          workflowStep: currentWorkflowStep + 1,
          ...(validated.metadata
            ? sanitizeMetadata(validated.metadata as Record<string, unknown>)
            : {}),
        },
      });
    } catch (memoryError) {
      const error = memoryError instanceof Error ? memoryError : new Error(String(memoryError));
      logger.warn({
        msg: 'Failed to store handoff memory, enqueueing for retry',
        error: error.message,
        requestId,
      });
      // Enqueue for retry instead of just logging
      await enqueueMemoryRetry(
        {
          content: `Handed off to ${validated.toAgent}: ${validated.instructions}`,
          memoryType: 'episodic',
          tags: ['handoff', validated.toAgent],
          metadata: {
            traceId: validated.traceId,
            toAgent: validated.toAgent,
            executionId: webhookResponse.executionId,
            workflowStep: currentWorkflowStep + 1,
            ...(validated.metadata || {}),
          },
        },
        error
      );
    }

    return {
      content: [{ type: 'text', text: JSON.stringify({ webhookUrl, executionId: webhookResponse.executionId, status: webhookResponse.status, toAgent: validated.toAgent }) }],
      structuredContent: { webhookUrl, executionId: webhookResponse.executionId, status: webhookResponse.status, toAgent: validated.toAgent },
    };
  },
};

export function generateRequestId(): string {
  return randomUUID();
}

// ───────────────────────────────────────────────────────────────────────────────
// Core Workflow Tools (New Generic Tools)
// ───────────────────────────────────────────────────────────────────────────────

const webhookAuthHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.n8n.webhookAuthToken) {
    headers[config.n8n.webhookHeaderName || 'x-api-key'] = config.n8n.webhookAuthToken;
  }
  return headers;
};

async function postToWebhook(path: string, payload: unknown): Promise<any> {
  const url = `${config.n8n.webhookUrl?.replace(/\/$/, '')}/webhook/${path.replace(/^\//, '')}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: webhookAuthHeaders(),
    body: JSON.stringify(payload ?? {}),
  });
  let text: string | null = null;
  try {
    text = await res.text();
  } catch {
    // ignore
  }
  if (!res.ok) {
    throw new MCPError(
      MCPErrorCode.EXTERNAL_SERVICE_ERROR,
      `Webhook call failed: ${res.status} ${res.statusText}${text ? ` - ${text}` : ''}`,
    );
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { ok: true, text };
  }
}

// Generic workflow trigger tool
const workflowTriggerInputSchema = z.object({
  workflowKey: z.string().min(1).describe('Human-readable workflow key (e.g., generate-video, edit-compilation, upload-to-tiktok)'),
  traceId: uuidSchema,
  payload: recordLike().optional().describe('Additional payload to pass to workflow'),
  callerPersona: z.string().optional(),
  runId: z.string().optional(),
  environment: z.string().default('production').describe('Environment (production, staging, development)'),
});

const workflowTriggerTool: MCPTool = {
  name: 'workflow_trigger',
  title: 'Trigger Workflow',
  description: 'Trigger any n8n workflow by key. Resolves workflow ID via mapping repository and POSTs to webhook. **REQUIRED**: traceId parameter MUST come from your system prompt (TRACE ID field). Example: workflow_trigger({workflowKey: "generate-video", traceId: "trace-aismr-001", payload: {screenplay: {...}}}). Do NOT create or invent a traceId - use the exact traceId from your system prompt.',
  inputSchema: workflowTriggerInputSchema,
  handler: async (params, requestId) => {
    const unwrapped = unwrapParams(params);
    const validated = workflowTriggerInputSchema.parse(unwrapped);

    logger.info({
      msg: 'MCP tool called',
      tool: 'workflow_trigger',
      params: sanitizeParams(validated),
      requestId,
    });

    // Resolve workflow mapping
    const mappingRepo = new WorkflowMappingRepository();
    const mapping = await mappingRepo.findByKey(validated.workflowKey, validated.environment);

    if (!mapping) {
      throw new NotFoundError(
        `Workflow mapping not found for key: ${validated.workflowKey} in environment: ${validated.environment}.`,
        'workflow',
        MCPErrorCode.EXTERNAL_SERVICE_ERROR
      );
    }

    // Validate trace exists
    const traceRepo = new TraceRepository();
    const trace = await traceRepo.getTrace(validated.traceId);
    if (!trace) {
      throw new NotFoundError(`Trace not found: ${validated.traceId}`, 'trace', MCPErrorCode.TRACE_NOT_FOUND);
    }

    // Build payload with standard envelope
    const payload = {
      traceId: validated.traceId,
      callerPersona: validated.callerPersona || trace.currentOwner || 'unknown',
      runId: validated.runId ?? null,
      trace,
      ...(validated.payload || {}),
    };

    // POST to webhook path: /webhook/tools/{workflowKey}
    const webhookPath = `tools/${validated.workflowKey}`;
    const result = await postToWebhook(webhookPath, payload);

    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      structuredContent: result,
    };
  },
};

// Consolidated jobs tool (unified upsert and summary actions)
const jobsInputSchema = z.object({
  action: z.enum(['upsert', 'summary']),
  traceId: uuidSchema,
  kind: z.enum(['video', 'edit']).optional(),
  scriptId: z.string().uuid('scriptId must be a valid UUID').optional(),
  provider: z.string().optional(),
  taskId: z.string().optional(),
  status: z.enum(jobStatusValues).optional(),
  url: z.string().optional(),
  error: z.string().optional(),
  metadata: recordLike().optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
});

const jobsTool: MCPTool = {
  name: 'jobs',
  title: 'Manage Jobs',
  description: 'Unified tool for job tracking. Use action="upsert" to create/update jobs, action="summary" to get counts. **REQUIRED**: traceId parameter MUST come from your system prompt (TRACE ID field). Example: jobs({action: "upsert", traceId: "trace-aismr-001", kind: "video", provider: "runway", taskId: "task-123", status: "queued"}). Do NOT create or invent a traceId - use the exact traceId from your system prompt.',
  inputSchema: jobsInputSchema,
  handler: async (params, requestId) => {
    const unwrapped = unwrapParams(params);
    const validated = jobsInputSchema.parse(unwrapped);

    logger.info({
      msg: 'MCP tool called',
      tool: 'jobs',
      params: sanitizeParams(validated),
      requestId,
    });

    if (validated.action === 'summary') {
      const videoSummary = await new VideoJobsRepository().summaryByTrace(validated.traceId);
      const editSummary = await new EditJobsRepository().summaryByTrace(validated.traceId);

      const combined = {
        total: videoSummary.total + editSummary.total,
        completed: videoSummary.completed + editSummary.completed,
        failed: videoSummary.failed + editSummary.failed,
        pending: videoSummary.pending + editSummary.pending,
        breakdown: {
          video: videoSummary,
          edit: editSummary,
        },
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(combined) }],
        structuredContent: combined,
      };
    }

    // action === 'upsert'
    if (!validated.kind || !validated.provider || !validated.taskId || !validated.status) {
      throw new ValidationError(
        'For action="upsert", kind, provider, taskId, and status are required',
        'action'
      );
    }

    const parseDate = (value?: string) => {
      if (!value) return undefined;
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) {
        throw new Error(`Invalid date value: ${value}`);
      }
      return parsed;
    };

    if (validated.kind === 'video') {
      const repo = new VideoJobsRepository();
      const job = await repo.upsertJob({
        traceId: validated.traceId,
        scriptId: validated.scriptId ?? null,
        provider: validated.provider,
        taskId: validated.taskId,
        status: validated.status,
        assetUrl: validated.url ?? null,
        error: validated.error ?? null,
        metadata: validated.metadata ?? {},
        startedAt: parseDate(validated.startedAt) ?? null,
        completedAt: parseDate(validated.completedAt) ?? null,
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(job) }],
        structuredContent: job,
      };
    }

    const repo = new EditJobsRepository();
    const job = await repo.upsertJob({
      traceId: validated.traceId,
      provider: validated.provider,
      taskId: validated.taskId,
      status: validated.status,
      finalUrl: validated.url ?? null,
      error: validated.error ?? null,
      metadata: validated.metadata ?? {},
      startedAt: parseDate(validated.startedAt) ?? null,
      completedAt: parseDate(validated.completedAt) ?? null,
    });

    return {
      content: [{ type: 'text', text: JSON.stringify(job) }],
      structuredContent: job,
    };
  },
};

/**
 * MCP Tools - Persona-facing tools only
 * 
 * Core tools (7 total):
 * - Memory: memory_search, memory_store
 * - Trace: trace_prepare, trace_update, handoff_to_agent
 * - Jobs: jobs (unified upsert + summary)
 * - Workflow: workflow_trigger (generic workflow invoker)
 * 
 * Internal utilities (context, session, trace creation) are called directly
 * via repositories/services, not exposed as MCP tools.
 */
export const mcpTools: MCPTool[] = [
  // Core memory tools
  memorySearchTool,
  memoryStoreTool,
  
  // Core trace coordination tools
  tracePrepareTool,
  traceUpdateTool,
  handoffToAgentTool,

  // Core job tracking (unified tool)
  jobsTool,
  
  // Core workflow trigger (generic)
  workflowTriggerTool,
];
