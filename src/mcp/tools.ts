import { z } from 'zod';
import { searchMemories } from '../tools/memory/searchTool.js';
import { storeMemory } from '../tools/memory/storeTool.js';
import { evolveMemory } from '../tools/memory/evolveTool.js';
import { getPersona } from '../tools/context/getPersonaTool.js';
import { getProject } from '../tools/context/getProjectTool.js';
import { SessionRepository } from '../db/repositories/session-repository.js';
import type { SessionContext } from '../db/repositories/session-repository.js';
import { MemoryRepository, TraceRepository, AgentWebhookRepository } from '../db/repositories/index.js';
import { logger, sanitizeParams } from '../utils/logger.js';
import { stripEmbeddings } from '../utils/response-formatter.js';
import { randomUUID } from 'crypto';
import { config } from '../config/index.js';
import { N8nClient } from '../integrations/n8n/client.js';

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
  query: z.string(),
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
  content: z.string(),
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

const memoryEvolveInputSchema = z.object({
  memoryId: z.string(),
  updates: z.object({
    addTags: stringArrayLike().optional(),
    removeTags: stringArrayLike().optional(),
    addLinks: stringArrayLike().optional(),
    removeLinks: stringArrayLike().optional(),
    updateSummary: z.string().optional(),
  }),
});

const contextGetPersonaInputSchema = z.object({
  personaName: z.string(),
});

const contextGetProjectInputSchema = z.object({
  projectName: z.string(),
});

const sessionGetContextInputSchema = z.object({
  sessionId: z.string(),
  persona: z.string().optional(),
  project: z.string().optional(),
});

const sessionUpdateContextInputSchema = z.object({
  sessionId: z.string(),
  context: recordLike(),
});

// Trace coordination schemas
const traceCreateInputSchema = z.object({
  projectId: z.string(),
  sessionId: z.string().optional(),
  metadata: recordLike().optional(),
});

const handoffToAgentInputSchema = z.object({
  traceId: z.string(),
  toAgent: z.string(),
  instructions: z.string(),
  metadata: recordLike().optional(),
});

const workflowCompleteInputSchema = z.object({
  traceId: z.string(),
  status: z.enum(['completed', 'failed']),
  outputs: recordLike().optional(),
  notes: z.string().optional(),
});

// Memory search by run schema
const memorySearchByRunSchema = z.object({
  runId: z.string(),
  persona: z.string().optional(),
  project: z.string().optional(),
  k: numberLike().optional(),
});

// Memory tools
const memorySearchTool: MCPTool = {
  name: 'memory_search',
  title: 'Search Memories',
  description: 'Use this to retrieve prior outputs via hybrid vector + keyword search (newest-first when traceId is provided)',
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
  description: 'Log a single-line memory entry tagged with persona/project/traceId (array fields must always be JSON arrays, even for a single value)',
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
    const metadata = {
      ...(rest.metadata || {}),
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

const memoryEvolveTool: MCPTool = {
  name: 'memory_evolve',
  title: 'Evolve Memory',
  description: 'Update an existing memory (add/remove tags, links, or summary) without creating a new record',
  inputSchema: memoryEvolveInputSchema,
  handler: async (params, requestId) => {
    const unwrapped = unwrapParams(params);
    const validated = memoryEvolveInputSchema.parse(unwrapped);

    logger.info({
      msg: 'MCP tool called',
      tool: 'memory_evolve',
      params: sanitizeParams(validated),
      requestId,
    });

    const result = await evolveMemory(validated);
    // Strip embedding from response
    const cleanResult = stripEmbeddings(result);
    return {
      content: [{ type: 'text', text: JSON.stringify(cleanResult) }],
      structuredContent: cleanResult,
    };
  },
};

// Context tools
const contextGetPersonaTool: MCPTool = {
  name: 'context_get_persona',
  title: 'Get Persona',
  description: 'Load the canonical persona prompt and guardrails (Casey calls this for Iggy before handoff)',
  inputSchema: contextGetPersonaInputSchema,
  handler: async (params, requestId) => {
    const unwrapped = unwrapParams(params);
    const validated = contextGetPersonaInputSchema.parse(unwrapped);

    logger.info({
      msg: 'MCP tool called',
      tool: 'context_get_persona',
      params: sanitizeParams(validated),
      requestId,
    });

    const result = await getPersona(validated);
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      structuredContent: result,
    };
  },
};

const contextGetProjectTool: MCPTool = {
  name: 'context_get_project',
  title: 'Get Project',
  description: 'Retrieve project-level guardrails, workflows, and constraints for the active run',
  inputSchema: contextGetProjectInputSchema,
  handler: async (params, requestId) => {
    const unwrapped = unwrapParams(params);
    const validated = contextGetProjectInputSchema.parse(unwrapped);

    logger.info({
      msg: 'MCP tool called',
      tool: 'context_get_project',
      params: sanitizeParams(validated),
      requestId,
    });

    const result = await getProject(validated);
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      structuredContent: result,
    };
  },
};

// Session tools
const sessionGetContextTool: MCPTool = {
  name: 'session_get_context',
  title: 'Get Session Context',
  description: 'Load or initialize session working memory (user prefs, last intent, history)',
  inputSchema: sessionGetContextInputSchema,
  handler: async (params, requestId) => {
    const unwrapped = unwrapParams(params);
    const validated = sessionGetContextInputSchema.parse(unwrapped);

    logger.info({
      msg: 'MCP tool called',
      tool: 'session_get_context',
      params: sanitizeParams(validated),
      requestId,
    });

    const repository = new SessionRepository();
    
    // Preserve full userId with platform prefix (e.g., "telegram:123456")
    const userId = validated.sessionId;
    
    // Look up existing session to get persona/project if not provided
    const existingSession = await repository.findById(validated.sessionId);
    
    // Determine persona: use param if provided, otherwise existing session value
    const persona = validated.persona || existingSession?.persona;
    
    // Determine project: use param if provided, otherwise existing session value
    const project = validated.project || existingSession?.project;
    
    if (!persona || !project) {
      throw new Error(
        'Session requires persona and project. ' +
        'Provide them when creating a new session via session_get_context.'
      );
    }
    
    const session = await repository.findOrCreate(
      validated.sessionId,
      userId, // Full user ID with platform prefix
      persona,
      project
    );
    const context = await repository.getContext(validated.sessionId);

    return {
      content: [{ type: 'text', text: JSON.stringify({ session, context }) }],
      structuredContent: { session, context },
    };
  },
};

const sessionUpdateContextTool: MCPTool = {
  name: 'session_update_context',
  title: 'Update Session Context',
  description: 'Persist updates to session working memory (intent, preferences, topics)',
  inputSchema: sessionUpdateContextInputSchema,
  handler: async (params, requestId) => {
    const unwrapped = unwrapParams(params);
    const validated = sessionUpdateContextInputSchema.parse(unwrapped);

    logger.info({
      msg: 'MCP tool called',
      tool: 'session_update_context',
      params: sanitizeParams(validated),
      requestId,
    });

    const repository = new SessionRepository();
    await repository.updateContext(validated.sessionId, validated.context as SessionContext);

    return {
      content: [{ type: 'text', text: JSON.stringify({ success: true }) }],
      structuredContent: { success: true },
    };
  },
};

// Memory search by run tool
const memorySearchByRunTool: MCPTool = {
  name: 'memory_searchByRun',
  title: 'Search Memories by Run',
  description: 'Replay a legacy run by fetching memories where metadata.runId matches',
  inputSchema: memorySearchByRunSchema,
  handler: async (params, requestId) => {
    const unwrapped = unwrapParams(params);
    const validated = memorySearchByRunSchema.parse(unwrapped);

    logger.info({
      msg: 'MCP tool called',
      tool: 'memory_searchByRun',
      params: sanitizeParams(validated),
      requestId,
    });

    const repository = new MemoryRepository();
    const startTime = Date.now();
    const memories = await repository.findByRunId(validated.runId, {
      persona: validated.persona,
      project: validated.project,
      limit: validated.k || 20,
    });

    const cleanMemories = stripEmbeddings(memories) as Record<string, unknown>[];
    const result = {
      memories: cleanMemories,
      totalFound: cleanMemories.length,
      searchTime: Date.now() - startTime,
    };

    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      structuredContent: result,
    };
  },
};

// Trace coordination tools
const traceCreateTool: MCPTool = {
  name: 'trace_create',
  title: 'Create Trace',
  description: 'Always call this at the start of a production run to mint the shared traceId',
  inputSchema: traceCreateInputSchema,
  handler: async (params, requestId) => {
    const unwrapped = unwrapParams(params);
    const validated = traceCreateInputSchema.parse(unwrapped);

    logger.info({
      msg: 'MCP tool called',
      tool: 'trace_create',
      params: sanitizeParams(validated),
      requestId,
    });

    const traceRepo = new TraceRepository();
    const trace = await traceRepo.create({
      projectId: validated.projectId,
      sessionId: validated.sessionId,
      metadata: validated.metadata,
    });

    return {
      content: [{ type: 'text', text: JSON.stringify({ traceId: trace.traceId, status: trace.status, createdAt: trace.createdAt }) }],
      structuredContent: { traceId: trace.traceId, status: trace.status, createdAt: trace.createdAt },
    };
  },
};

const handoffToAgentTool: MCPTool = {
  name: 'handoff_to_agent',
  title: 'Handoff to Agent',
  description: 'Resolve the target agent’s webhook, invoke n8n, and log the handoff (requires active traceId)',
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
    const webhookRepo = new AgentWebhookRepository();

    const targetAgent = validated.toAgent.trim().toLowerCase();

    // Validate trace exists and is active
    const trace = await traceRepo.findByTraceId(validated.traceId);
    if (!trace) {
      throw new Error(`Trace not found: ${validated.traceId}`);
    }
    if (trace.status !== 'active') {
      throw new Error(`Trace is not active (status: ${trace.status})`);
    }

    // Lookup agent webhook
    const webhook = await webhookRepo.findByAgentName(targetAgent);
    if (!webhook) {
      throw new Error(`Agent webhook not found: ${validated.toAgent}`);
    }
    if (!webhook.isActive) {
      throw new Error(`Agent webhook is not active: ${validated.toAgent}`);
    }

    // Construct webhook URL
    const webhookUrl = `${config.n8n.webhookUrl}${webhook.webhookPath}`;

    // Build payload
    const payload = {
      traceId: validated.traceId,
      instructions: validated.instructions,
      metadata: validated.metadata || {},
      projectId: trace.projectId,
      sessionId: trace.sessionId,
    };

    // Invoke webhook
    const n8nClient = new N8nClient({
      baseUrl: config.n8n.baseUrl || 'http://n8n:5678',
      apiKey: config.n8n.apiKey,
    });

    const webhookResponse = await n8nClient.invokeWebhook(webhookUrl, payload, {
      method: webhook.method,
      authType: webhook.authType as 'none' | 'header' | 'basic' | 'bearer',
      authConfig: webhook.authConfig,
      authToken: config.n8n.webhookAuthToken,
      authHeaderName: config.n8n.webhookHeaderName,
      timeoutMs: webhook.timeoutMs || undefined,
    });

    // Store handoff event to memory
    try {
      await storeMemory({
        content: `Handed off to ${validated.toAgent}: ${validated.instructions}`,
        memoryType: 'episodic',
        tags: ['handoff', validated.toAgent],
        metadata: {
          traceId: validated.traceId,
          toAgent: validated.toAgent,
          executionId: webhookResponse.executionId,
        },
      });
    } catch (memoryError) {
      logger.warn({
        msg: 'Failed to store handoff memory',
        error: memoryError instanceof Error ? memoryError.message : String(memoryError),
        requestId,
      });
    }

    return {
      content: [{ type: 'text', text: JSON.stringify({ webhookUrl, executionId: webhookResponse.executionId, status: webhookResponse.status, toAgent: validated.toAgent }) }],
      structuredContent: { webhookUrl, executionId: webhookResponse.executionId, status: webhookResponse.status, toAgent: validated.toAgent },
    };
  },
};

const workflowCompleteTool: MCPTool = {
  name: 'workflow_complete',
  title: 'Complete Workflow',
  description: 'Mark the trace as completed/failed and attach final outputs for Casey/Quinn',
  inputSchema: workflowCompleteInputSchema,
  handler: async (params, requestId) => {
    const unwrapped = unwrapParams(params);
    const validated = workflowCompleteInputSchema.parse(unwrapped);

    logger.info({
      msg: 'MCP tool called',
      tool: 'workflow_complete',
      params: sanitizeParams(validated),
      requestId,
    });

    const traceRepo = new TraceRepository();

    // Validate trace exists
    const trace = await traceRepo.findByTraceId(validated.traceId);
    if (!trace) {
      throw new Error(`Trace not found: ${validated.traceId}`);
    }

    // Update trace status
    const updatedTrace = await traceRepo.updateStatus(
      validated.traceId,
      validated.status,
      validated.outputs
    );

    if (!updatedTrace) {
      throw new Error(`Failed to update trace: ${validated.traceId}`);
    }

    // Store completion event to memory
    try {
      await storeMemory({
        content: `Workflow ${validated.status}: ${validated.notes || 'No notes'}`,
        memoryType: 'episodic',
        tags: ['workflow-complete', validated.status],
        metadata: {
          traceId: validated.traceId,
          status: validated.status,
          outputs: validated.outputs,
        },
      });
    } catch (memoryError) {
      logger.warn({
        msg: 'Failed to store completion memory',
        error: memoryError instanceof Error ? memoryError.message : String(memoryError),
        requestId,
      });
    }

    return {
      content: [{ type: 'text', text: JSON.stringify({ traceId: updatedTrace.traceId, status: updatedTrace.status, completedAt: updatedTrace.completedAt, outputs: updatedTrace.outputs }) }],
      structuredContent: { traceId: updatedTrace.traceId, status: updatedTrace.status, completedAt: updatedTrace.completedAt, outputs: updatedTrace.outputs },
    };
  },
};

/**
 * MCP Tools - Focus on memory operations and trace-based coordination
 * 
 * Architecture change:
 * - Prompts are now exposed via MCP Prompt API (loaded from procedural memories)
 * - Each persona ships its own n8n workflow JSON (casey → quinn) and is triggered via handoff_to_agent
 * - Trace-based coordination replaces legacy run_state and handoff tools
 * - These tools focus on memory, session management, and agent coordination
 */
export const mcpTools: MCPTool[] = [
  // Memory tools
  memorySearchTool,
  memoryStoreTool,
  memoryEvolveTool,
  memorySearchByRunTool,
  
  // Context tools
  contextGetPersonaTool,
  contextGetProjectTool,

  // Trace coordination tools
  traceCreateTool,
  handoffToAgentTool,
  workflowCompleteTool,
  
  // Session tools
  sessionGetContextTool,
  sessionUpdateContextTool,
];

export function generateRequestId(): string {
  return randomUUID();
}
