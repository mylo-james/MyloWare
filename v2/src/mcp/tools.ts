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
import { randomUUID } from 'crypto';

export interface MCPTool {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodType;
  handler: (params: unknown, requestId: string) => Promise<{
    content: Array<{ type: 'text'; text: string }>;
    structuredContent?: unknown;
    isError?: boolean;
  }>;
}

// Memory tools
const memorySearchTool: MCPTool = {
  name: 'memory_search',
  title: 'Search Memories',
  description: 'Search memories using hybrid vector + keyword retrieval',
  inputSchema: z.object({
    query: z.string().describe('Search query'),
    memoryTypes: z
      .array(z.enum(['episodic', 'semantic', 'procedural']))
      .optional()
      .describe('Filter by memory types'),
    project: z.string().optional().describe('Filter by project name'),
    persona: z.string().optional().describe('Filter by persona name'),
    limit: z.number().optional().describe('Maximum number of results'),
    minSimilarity: z.number().optional().describe('Minimum similarity threshold (0-1)'),
    temporalBoost: z.boolean().optional().describe('Boost recent memories'),
    expandGraph: z.boolean().optional().describe('Expand to linked memories'),
    maxHops: z.number().optional().describe('Maximum hops in graph (default: 2)'),
  }),
  handler: async (params, requestId) => {
    const validated = z
      .object({
        query: z.string(),
        memoryTypes: z.array(z.enum(['episodic', 'semantic', 'procedural'])).optional(),
        project: z.string().optional(),
        persona: z.string().optional(),
        limit: z.number().optional(),
        minSimilarity: z.number().optional(),
        temporalBoost: z.boolean().optional(),
        expandGraph: z.boolean().optional(),
        maxHops: z.number().optional(),
      })
      .parse(params);

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
  inputSchema: z.object({
    content: z.string().describe('Memory content (single line)'),
    memoryType: z.enum(['episodic', 'semantic', 'procedural']).describe('Type of memory'),
    persona: z.array(z.string()).optional().describe('Associated personas'),
    project: z.array(z.string()).optional().describe('Associated projects'),
    tags: z.array(z.string()).optional().describe('Tags for categorization'),
    metadata: z.record(z.unknown()).optional().describe('Additional metadata'),
  }),
  handler: async (params, requestId) => {
    const validated = z
      .object({
        content: z.string(),
        memoryType: z.enum(['episodic', 'semantic', 'procedural']),
        persona: z.array(z.string()).optional(),
        project: z.array(z.string()).optional(),
        tags: z.array(z.string()).optional(),
        metadata: z.record(z.unknown()).optional(),
      })
      .parse(params);

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
  inputSchema: z.object({
    memoryId: z.string().describe('Memory ID to update'),
    updates: z
      .object({
        addTags: z.array(z.string()).optional(),
        removeTags: z.array(z.string()).optional(),
        addLinks: z.array(z.string()).optional(),
        removeLinks: z.array(z.string()).optional(),
        updateSummary: z.string().optional(),
      })
      .describe('Updates to apply'),
  }),
  handler: async (params, requestId) => {
    const validated = z
      .object({
        memoryId: z.string(),
        updates: z.object({
          addTags: z.array(z.string()).optional(),
          removeTags: z.array(z.string()).optional(),
          addLinks: z.array(z.string()).optional(),
          removeLinks: z.array(z.string()).optional(),
          updateSummary: z.string().optional(),
        }),
      })
      .parse(params);

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
  inputSchema: z.object({
    personaName: z.string().describe('Name of the persona to load'),
  }),
  handler: async (params, requestId) => {
    const validated = z.object({ personaName: z.string() }).parse(params);

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
  inputSchema: z.object({
    projectName: z.string().describe('Name of the project to load'),
  }),
  handler: async (params, requestId) => {
    const validated = z.object({ projectName: z.string() }).parse(params);

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
  inputSchema: z.object({
    intent: z.string().describe('Natural language intent'),
    project: z.string().optional().describe('Filter by project'),
    persona: z.string().optional().describe('Filter by persona'),
    limit: z.number().optional().describe('Maximum number of results'),
  }),
  handler: async (params, requestId) => {
    const validated = z
      .object({
        intent: z.string(),
        project: z.string().optional(),
        persona: z.string().optional(),
        limit: z.number().optional(),
      })
      .parse(params);

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
  inputSchema: z.object({
    workflowId: z.string().describe('Workflow ID from discovery'),
    input: z.record(z.unknown()).describe('Input parameters for workflow'),
    sessionId: z.string().optional().describe('Session ID for tracking'),
    waitForCompletion: z.boolean().optional().describe('Wait for completion'),
  }),
  handler: async (params, requestId) => {
    const validated = z
      .object({
        workflowId: z.string(),
        input: z.record(z.unknown()),
        sessionId: z.string().optional(),
        waitForCompletion: z.boolean().optional(),
      })
      .parse(params);

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
  inputSchema: z.object({
    workflowRunId: z.string().describe('Workflow run ID'),
  }),
  handler: async (params, requestId) => {
    const validated = z.object({ workflowRunId: z.string() }).parse(params);

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
  inputSchema: z.object({
    question: z.string().describe('Question to ask the user'),
    suggestedOptions: z.array(z.string()).optional().describe('Optional suggested answers'),
  }),
  handler: async (params, requestId) => {
    const validated = z
      .object({
        question: z.string(),
        suggestedOptions: z.array(z.string()).optional(),
      })
      .parse(params);

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
  inputSchema: z.object({
    sessionId: z.string().describe('Session ID'),
  }),
  handler: async (params, requestId) => {
    const validated = z.object({ sessionId: z.string() }).parse(params);

    logger.info({
      msg: 'MCP tool called',
      tool: 'session_get_context',
      params: sanitizeParams(validated),
      requestId,
    });

    const repository = new SessionRepository();
    const session = await repository.findOrCreate(
      validated.sessionId,
      'unknown',
      'casey',
      'aismr'
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
  inputSchema: z.object({
    sessionId: z.string().describe('Session ID'),
    context: z.record(z.unknown()).describe('Working memory to store'),
  }),
  handler: async (params, requestId) => {
    const validated = z
      .object({
        sessionId: z.string(),
        context: z.record(z.unknown()),
      })
      .parse(params);

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

