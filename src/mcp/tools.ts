import { z } from 'zod';
import { searchMemories } from '../tools/memory/searchTool.js';
import { storeMemory } from '../tools/memory/storeTool.js';
import { evolveMemory } from '../tools/memory/evolveTool.js';
import { getPersona } from '../tools/context/getPersonaTool.js';
import { getProject } from '../tools/context/getProjectTool.js';
import { clarifyAsk } from '../tools/clarify/index.js';
import { discoverPrompts } from '../tools/prompt/discoverTool.js';
import { SessionRepository } from '../db/repositories/session-repository.js';
import { MemoryRepository, RunRepository, HandoffRepository, RunEventsRepository } from '../db/repositories/index.js';
import { logger, sanitizeParams } from '../utils/logger.js';
import { stripEmbeddings } from '../utils/response-formatter.js';
import { randomUUID } from 'crypto';

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
  const { sessionId, format, searchMode, role, embeddingText, ...toolParams } = workingObj;
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
  limit: numberLike().optional(),
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

const clarifyAskInputSchema = z.object({
  question: z.string(),
  suggestedOptions: z.array(z.string()).optional(),
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

const promptDiscoverInputSchema = z.object({
  persona: z.string(),
  project: z.string(),
  intent: z.string().optional(),
  limit: numberLike().optional(),
});

// Run state schemas
const runStateCreateOrResumeSchema = z.object({
  sessionId: z.string().optional(),
  persona: z.string(),
  project: z.string(),
  instructions: z.string().optional(),
});

const runStateReadSchema = z.object({
  runId: z.string(),
});

const runStateUpdateSchema = z.object({
  runId: z.string(),
  patch: z.object({
    currentStep: z.string().optional(),
    status: z.string().optional(),
    stateBlob: recordLike().optional(),
    custodianAgent: z.string().optional(),
  }),
});

const runStateAppendEventSchema = z.object({
  runId: z.string(),
  eventType: z.string(),
  actor: z.string().optional(),
  payload: recordLike().optional(),
});

// Handoff schemas
const handoffCreateSchema = z.object({
  runId: z.string(),
  toPersona: z.string(),
  taskBrief: z.string().optional(),
  requiredOutputs: recordLike().optional(),
});

const handoffClaimSchema = z.object({
  handoffId: z.string(),
  agentId: z.string(),
  ttlMs: numberLike().optional(),
});

const handoffCompleteSchema = z.object({
  handoffId: z.string(),
  status: z.enum(['done', 'returned']),
  outputs: recordLike().optional(),
  notes: z.string().optional(),
});

const handoffListPendingSchema = z.object({
  runId: z.string().optional(),
  persona: z.string().optional(),
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
  description: 'Search memories using hybrid vector + keyword retrieval',
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
  description: 'Store a new memory with auto-summarization and auto-linking',
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

    const { runId, handoffId, relatedTo, ...rest } = validated;
    const metadata = {
      ...(rest.metadata || {}),
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
  description: 'Update existing memory (add/remove tags, links, update summary)',
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
  description: 'Load persona configuration by name',
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
  description: 'Load project configuration by name',
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

// Clarification tool
const clarifyAskTool: MCPTool = {
  name: 'clarify_ask',
  title: 'Ask for Clarification',
  description: 'Ask user for clarification with optional suggested options',
  inputSchema: clarifyAskInputSchema,
  handler: async (params, requestId) => {
    const unwrapped = unwrapParams(params);
    const validated = clarifyAskInputSchema.parse(unwrapped);

    logger.info({
      msg: 'MCP tool called',
      tool: 'clarify_ask',
      params: sanitizeParams(validated),
      requestId,
    });

    const result = await clarifyAsk(validated);
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
  description: 'Load session context and working memory',
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
  description: 'Update session working memory',
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
    await repository.updateContext(validated.sessionId, validated.context as any);

    return {
      content: [{ type: 'text', text: JSON.stringify({ success: true }) }],
      structuredContent: { success: true },
    };
  },
};

// Run state tools
const runStateCreateOrResumeTool: MCPTool = {
  name: 'run_state_createOrResume',
  title: 'Create or Resume Agent Run',
  description: 'Create a new agent run or resume an existing one for the session',
  inputSchema: runStateCreateOrResumeSchema,
  handler: async (params, requestId) => {
    const unwrapped = unwrapParams(params);
    const validated = runStateCreateOrResumeSchema.parse(unwrapped);

    logger.info({
      msg: 'MCP tool called',
      tool: 'run_state_createOrResume',
      params: sanitizeParams(validated),
      requestId,
    });

    const repo = new RunRepository();
    const run = validated.sessionId
      ? await repo.findOrCreateForSession(
          validated.sessionId,
          validated.persona,
          validated.project,
          validated.instructions
        )
      : await repo.create({
          persona: validated.persona,
          project: validated.project,
          instructions: validated.instructions,
        });

    return {
      content: [{ type: 'text', text: JSON.stringify({ runId: run.id }) }],
      structuredContent: { runId: run.id },
    };
  },
};

const runStateReadTool: MCPTool = {
  name: 'run_state_read',
  title: 'Read Agent Run',
  description: 'Read the current state of an agent run',
  inputSchema: runStateReadSchema,
  handler: async (params, requestId) => {
    const unwrapped = unwrapParams(params);
    const validated = runStateReadSchema.parse(unwrapped);

    logger.info({
      msg: 'MCP tool called',
      tool: 'run_state_read',
      params: sanitizeParams(validated),
      requestId,
    });

    const repo = new RunRepository();
    const run = await repo.findById(validated.runId);

    if (!run) {
      throw new Error(`Run not found: ${validated.runId}`);
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(run) }],
      structuredContent: run,
    };
  },
};

const runStateUpdateTool: MCPTool = {
  name: 'run_state_update',
  title: 'Update Agent Run',
  description: 'Update the state of an agent run',
  inputSchema: runStateUpdateSchema,
  handler: async (params, requestId) => {
    const unwrapped = unwrapParams(params);
    const validated = runStateUpdateSchema.parse(unwrapped);

    logger.info({
      msg: 'MCP tool called',
      tool: 'run_state_update',
      params: sanitizeParams(validated),
      requestId,
    });

    const repo = new RunRepository();
    await repo.update(validated.runId, validated.patch);

    return {
      content: [{ type: 'text', text: JSON.stringify({ ok: true }) }],
      structuredContent: { ok: true },
    };
  },
};

const runStateAppendEventTool: MCPTool = {
  name: 'run_state_appendEvent',
  title: 'Append Event to Run',
  description: 'Append an event to the run event log',
  inputSchema: runStateAppendEventSchema,
  handler: async (params, requestId) => {
    const unwrapped = unwrapParams(params);
    const validated = runStateAppendEventSchema.parse(unwrapped);

    logger.info({
      msg: 'MCP tool called',
      tool: 'run_state_appendEvent',
      params: sanitizeParams(validated),
      requestId,
    });

    const repo = new RunEventsRepository();
    await repo.append({
      runId: validated.runId,
      eventType: validated.eventType,
      actor: validated.actor,
      payload: validated.payload,
    });

    return {
      content: [{ type: 'text', text: JSON.stringify({ ok: true }) }],
      structuredContent: { ok: true },
    };
  },
};

// Handoff tools
const handoffCreateTool: MCPTool = {
  name: 'handoff_create',
  title: 'Create Handoff',
  description: 'Create a handoff task to delegate work to another persona',
  inputSchema: handoffCreateSchema,
  handler: async (params, requestId) => {
    const unwrapped = unwrapParams(params);
    const validated = handoffCreateSchema.parse(unwrapped);

    logger.info({
      msg: 'MCP tool called',
      tool: 'handoff_create',
      params: sanitizeParams(validated),
      requestId,
    });

    const repo = new HandoffRepository();
    const handoff = await repo.create(validated);

    return {
      content: [{ type: 'text', text: JSON.stringify({ handoffId: handoff.id }) }],
      structuredContent: { handoffId: handoff.id },
    };
  },
};

const handoffClaimTool: MCPTool = {
  name: 'handoff_claim',
  title: 'Claim Handoff',
  description: 'Claim a handoff task with a TTL lease',
  inputSchema: handoffClaimSchema,
  handler: async (params, requestId) => {
    const unwrapped = unwrapParams(params);
    const validated = handoffClaimSchema.parse(unwrapped);

    logger.info({
      msg: 'MCP tool called',
      tool: 'handoff_claim',
      params: sanitizeParams(validated),
      requestId,
    });

    const repo = new HandoffRepository();
    const result = await repo.claim(
      validated.handoffId,
      validated.agentId,
      validated.ttlMs || 300000 // 5 minutes default
    );

    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      structuredContent: result,
    };
  },
};

const handoffCompleteTool: MCPTool = {
  name: 'handoff_complete',
  title: 'Complete Handoff',
  description: 'Mark a handoff task as complete',
  inputSchema: handoffCompleteSchema,
  handler: async (params, requestId) => {
    const unwrapped = unwrapParams(params);
    const validated = handoffCompleteSchema.parse(unwrapped);

    logger.info({
      msg: 'MCP tool called',
      tool: 'handoff_complete',
      params: sanitizeParams(validated),
      requestId,
    });

    const repo = new HandoffRepository();
    await repo.complete(validated.handoffId, {
      status: validated.status,
      outputs: validated.outputs,
      notes: validated.notes,
    });

    return {
      content: [{ type: 'text', text: JSON.stringify({ ok: true }) }],
      structuredContent: { ok: true },
    };
  },
};

const handoffListPendingTool: MCPTool = {
  name: 'handoff_listPending',
  title: 'List Pending Handoffs',
  description: 'List pending handoff tasks',
  inputSchema: handoffListPendingSchema,
  handler: async (params, requestId) => {
    const unwrapped = unwrapParams(params);
    const validated = handoffListPendingSchema.parse(unwrapped);

    logger.info({
      msg: 'MCP tool called',
      tool: 'handoff_listPending',
      params: sanitizeParams(validated),
      requestId,
    });

    const repo = new HandoffRepository();
    const handoffs = await repo.listPending(validated.runId, validated.persona);

    return {
      content: [{ type: 'text', text: JSON.stringify({ handoffs }) }],
      structuredContent: { handoffs },
    };
  },
};

// Memory search by run tool
const memorySearchByRunTool: MCPTool = {
  name: 'memory_searchByRun',
  title: 'Search Memories by Run',
  description: 'Search memories filtered by runId in metadata',
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

// Prompt discovery tool
const promptDiscoverTool: MCPTool = {
  name: 'prompt_discover',
  title: 'Discover Prompts',
  description: 'Discover available prompts for a persona and project',
  inputSchema: promptDiscoverInputSchema,
  handler: async (params, requestId) => {
    const unwrapped = unwrapParams(params);
    const validated = promptDiscoverInputSchema.parse(unwrapped);

    logger.info({
      msg: 'MCP tool called',
      tool: 'prompt_discover',
      params: sanitizeParams(validated),
      requestId,
    });

    const result = await discoverPrompts(validated);
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      structuredContent: result,
    };
  },
};

/**
 * MCP Tools - Focus on memory operations
 * 
 * Architecture change:
 * - Prompts are now exposed via MCP Prompt API (loaded from procedural memories)
 * - n8n workflows are exposed as toolWorkflow nodes in agent.workflow.json
 * - These tools focus on memory and session management
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
  
  // Run state tools
  runStateCreateOrResumeTool,
  runStateReadTool,
  runStateUpdateTool,
  runStateAppendEventTool,
  
  // Handoff tools
  handoffCreateTool,
  handoffClaimTool,
  handoffCompleteTool,
  handoffListPendingTool,
  
  // Other tools
  promptDiscoverTool,
  clarifyAskTool,
  sessionGetContextTool,
  sessionUpdateContextTool,
];

export function generateRequestId(): string {
  return randomUUID();
}
