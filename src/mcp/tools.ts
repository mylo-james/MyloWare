import { z } from 'zod';
import { searchMemories } from '../tools/memory/searchTool.js';
import { storeMemory } from '../tools/memory/storeTool.js';
import { evolveMemory } from '../tools/memory/evolveTool.js';
import { getPersona } from '../tools/context/getPersonaTool.js';
import { getProject } from '../tools/context/getProjectTool.js';
import { discoverWorkflow } from '../tools/workflow/discoverTool.js';
import { executeWorkflow } from '../tools/workflow/executeTool.js';
import { getWorkflowStatus } from '../tools/workflow/getStatusTool.js';
import { clarifyAsk } from '../tools/clarify/index.js';
import { SessionRepository } from '../db/repositories/session-repository.js';
import { logger, sanitizeParams } from '../utils/logger.js';
import { normalizeToolParams } from '../utils/workflow-params.js';
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

const truthyStrings = new Set(['true', '1', 'yes', 'y', 'on']);
const falsyStrings = new Set(['false', '0', 'no', 'n', 'off']);

function parseNumberString(value: string): number {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error('Number value cannot be empty');
  }
  const parsed = Number(trimmed);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid number: ${value}`);
  }
  return parsed;
}

function parseBooleanValue(value: string | number): boolean {
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
    throw new Error(`Invalid boolean number: ${value}`);
  }

  const normalized = value.trim().toLowerCase();
  if (truthyStrings.has(normalized)) {
    return true;
  }
  if (falsyStrings.has(normalized)) {
    return false;
  }
  throw new Error(`Invalid boolean string: ${value}`);
}

function parseStringArrayValue(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item));
      }
    } catch {
      // Fall through to comma parsing
    }
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === 'string') {
      return [parsed];
    }
  } catch {
    // Fall through to comma parsing
  }

  return trimmed
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseRecordValue(value: string): Record<string, unknown> {
  const trimmed = value.trim();
  if (!trimmed) {
    return {};
  }
  const parsed = JSON.parse(trimmed);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Expected JSON object for record value');
  }
  return parsed as Record<string, unknown>;
}

const numberLike = () =>
  z.union([z.number(), z.string().transform((value) => parseNumberString(value))]);

const booleanLike = () =>
  z.union([
    z.boolean(),
    z.string().transform((value) => parseBooleanValue(value)),
    z.number().transform((value) => parseBooleanValue(value)),
  ]);

const stringArrayLike = () =>
  z.union([
    z.array(z.string()),
    z.string().transform((value) => parseStringArrayValue(value)),
  ]);

const recordLike = () =>
  z.union([
    z.record(z.unknown()),
    z.string().transform((value) => parseRecordValue(value)),
  ]);

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

const workflowDiscoverInputSchema = z.object({
  intent: z.string(),
  project: z.string().optional(),
  persona: z.string().optional(),
  limit: numberLike().optional(),
});

const workflowExecuteInputSchema = z.object({
  workflowId: z.string(),
  input: recordLike(),
  sessionId: z.string().optional(),
  waitForCompletion: booleanLike().optional(),
});

const workflowStatusInputSchema = z.object({
  workflowRunId: z.string(),
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

// Memory tools
const memorySearchTool: MCPTool = {
  name: 'memory_search',
  title: 'Search Memories',
  description: 'Search memories using hybrid vector + keyword retrieval',
  inputSchema: memorySearchInputSchema,
  handler: async (params, requestId) => {
    const toolParams = normalizeToolParams(params);
    const validated = memorySearchInputSchema.parse(toolParams);

    logger.info({
      msg: 'MCP tool called',
      tool: 'memory_search',
      params: sanitizeParams(validated),
      requestId,
    });

    const result = await searchMemories(validated);
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      structuredContent: result,
    };
  },
};

const memoryStoreTool: MCPTool = {
  name: 'memory_store',
  title: 'Store Memory',
  description: 'Store a new memory with auto-summarization and auto-linking',
  inputSchema: memoryStoreInputSchema,
  handler: async (params, requestId) => {
    const toolParams = normalizeToolParams(params);
    const validated = memoryStoreInputSchema.parse(toolParams);

    logger.info({
      msg: 'MCP tool called',
      tool: 'memory_store',
      params: sanitizeParams(validated),
      requestId,
    });

    const result = await storeMemory(validated);
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      structuredContent: result,
    };
  },
};

const memoryEvolveTool: MCPTool = {
  name: 'memory_evolve',
  title: 'Evolve Memory',
  description: 'Update existing memory (add/remove tags, links, update summary)',
  inputSchema: memoryEvolveInputSchema,
  handler: async (params, requestId) => {
    const toolParams = normalizeToolParams(params);
    const validated = memoryEvolveInputSchema.parse(toolParams);

    logger.info({
      msg: 'MCP tool called',
      tool: 'memory_evolve',
      params: sanitizeParams(validated),
      requestId,
    });

    const result = await evolveMemory(validated);
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      structuredContent: result,
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
    const toolParams = normalizeToolParams(params);
    const validated = contextGetPersonaInputSchema.parse(toolParams);

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
    const toolParams = normalizeToolParams(params);
    const validated = contextGetProjectInputSchema.parse(toolParams);

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

// Workflow tools
const workflowDiscoverTool: MCPTool = {
  name: 'workflow_discover',
  title: 'Discover Workflow',
  description: 'Discover workflows by semantic intent',
  inputSchema: workflowDiscoverInputSchema,
  handler: async (params, requestId) => {
    const toolParams = normalizeToolParams(params);
    const validated = workflowDiscoverInputSchema.parse(toolParams);

    logger.info({
      msg: 'MCP tool called',
      tool: 'workflow_discover',
      params: sanitizeParams(validated),
      requestId,
    });

    const result = await discoverWorkflow(validated);
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      structuredContent: result,
    };
  },
};

const workflowExecuteTool: MCPTool = {
  name: 'workflow_execute',
  title: 'Execute Workflow',
  description: 'Execute a discovered workflow',
  inputSchema: workflowExecuteInputSchema,
  handler: async (params, requestId) => {
    const toolParams = normalizeToolParams(params);
    const validated = workflowExecuteInputSchema.parse(toolParams);

    logger.info({
      msg: 'MCP tool called',
      tool: 'workflow_execute',
      params: sanitizeParams(validated),
      requestId,
    });

    const result = await executeWorkflow(validated);
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      structuredContent: result,
    };
  },
};

const workflowStatusTool: MCPTool = {
  name: 'workflow_status',
  title: 'Get Workflow Status',
  description: 'Get status of a workflow execution',
  inputSchema: workflowStatusInputSchema,
  handler: async (params, requestId) => {
    const toolParams = normalizeToolParams(params);
    const validated = workflowStatusInputSchema.parse(toolParams);

    logger.info({
      msg: 'MCP tool called',
      tool: 'workflow_status',
      params: sanitizeParams(validated),
      requestId,
    });

    const result = await getWorkflowStatus(validated);
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
    const toolParams = normalizeToolParams(params);
    const validated = clarifyAskInputSchema.parse(toolParams);

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
    const toolParams = normalizeToolParams(params);
    const validated = sessionGetContextInputSchema.parse(toolParams);

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
    
    // Determine persona: use param if provided, otherwise existing session value, otherwise default
    const persona = validated.persona || existingSession?.persona || 'chat';
    
    // Determine project: use param if provided, otherwise existing session value, otherwise default
    const project = validated.project || existingSession?.project || 'aismr';
    
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
    const toolParams = normalizeToolParams(params);
    const validated = sessionUpdateContextInputSchema.parse(toolParams);

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

export const mcpTools: MCPTool[] = [
  memorySearchTool,
  memoryStoreTool,
  memoryEvolveTool,
  contextGetPersonaTool,
  contextGetProjectTool,
  workflowDiscoverTool,
  workflowExecuteTool,
  workflowStatusTool,
  clarifyAskTool,
  sessionGetContextTool,
  sessionUpdateContextTool,
];

export function generateRequestId(): string {
  return randomUUID();
}
