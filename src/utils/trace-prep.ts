import { TraceRepository, ProjectRepository } from '../db/repositories/index.js';
import type { Trace } from '../db/repositories/trace-repository.js';
import { getPersona } from '../tools/context/getPersonaTool.js';
import { getProject } from '../tools/context/getProjectTool.js';
import { searchMemories } from '../tools/memory/searchTool.js';
import { stripEmbeddings } from './response-formatter.js';
import { logger } from './logger.js';
import { DEFAULT_MEMORY_LIMIT } from './constants.js';

export interface TracePrepParams {
  traceId?: string;
  instructions?: string;
  sessionId?: string;
  source?: string;
  metadata?: Record<string, unknown>;
  memoryLimit?: number;
}

export interface TracePrepResult {
  trace: {
    traceId: string;
    projectId: string;
    currentOwner: string;
    status: string;
    instructions: string | null;
    workflowStep: number | null;
    sessionId: string | null;
    metadata: Record<string, unknown>;
  };
  traceId: string;
  justCreated: boolean;
  persona: {
    name: string;
    description: string;
    capabilities: string[];
    tone: string;
    defaultProject: string | null;
    systemPrompt: string | null;
    allowedTools: string[];
  };
  personaMetadata: Record<string, unknown>;
  project: {
    id: string;
    name: string;
    description: string;
    guardrails: Record<string, unknown> | string;
    settings: Record<string, unknown>;
  };
  availableProjects?: Array<{
    id: string;
    name: string;
    description: string;
  }>;
  memorySummary: string;
  systemPrompt: string;
  allowedTools: string[];
  instructions: string;
}

/**
 * Builds the Casey prompt for new traces without a project
 */
export function buildCaseyPrompt(params: {
  instructions: string;
  memoryLines: string;
  availableProjects: Array<{ id: string; name: string; description: string }>;
  traceId: string;
}): string {
  const projectList = params.availableProjects
    .map((p) => `- ${p.id}: ${p.description}`)
    .join('\n');

  const caseyTasks = [
    'You are Casey, the Showrunner.',
    `TRACE ID: ${params.traceId}`,
    `**CRITICAL**: You MUST use this exact traceId for ALL tool calls. Do NOT create or invent a traceId.`,
    '',
    `USER MESSAGE: ${params.instructions || 'User opened a chat without providing additional instructions yet.'}`,
    'TASK:',
    '1. Determine which project this request is for by matching the user message to one of the available projects below',
    `2. Use set_project tool to set the project: set_project({traceId: "${params.traceId}", projectId: "aismr"}) or set_project({traceId: "${params.traceId}", projectId: "genreact"})`,
    '   - The traceId comes from the TRACE ID above - use that exact value',
    '   - The projectId is the project "id" from the available projects list below',
    `3. **REQUIRED**: You MUST call handoff_to_agent tool with traceId="${params.traceId}" and the appropriate persona`,
    '   - Do NOT just store a memory about handoff - you MUST actually call the handoff_to_agent tool',
    `   - Example: handoff_to_agent({traceId: "${params.traceId}", toAgent: "iggy", instructions: "Generate 12 modifiers..."})`,
    '   - **NEVER** create or invent a traceId - always use the traceId provided above',
    '',
    'Available projects:',
    projectList || 'No projects available. Contact administrator.',
    '',
    `UPSTREAM WORK:\n${params.memoryLines}`,
  ];
  return caseyTasks.join('\n\n');
}

/**
 * Formats guardrails for display in prompts
 */
export function formatGuardrails(guardrails: unknown): string {
  if (typeof guardrails === 'string') return guardrails;
  try {
    return JSON.stringify(guardrails, null, 2);
  } catch {
    return String(guardrails);
  }
}

/**
 * Builds the persona-specific prompt for traces with a known project
 */
export function buildPersonaPrompt(params: {
  personaPrompt: string | null;
  trace: Trace;
  projectContext: { name: string; description?: string; guardrails?: unknown };
  instructions: string;
  memoryLines: string;
}): string {
  const promptPieces = [
    params.personaPrompt || `You are ${params.trace.currentOwner || 'an AISMR agent'}.`,
    `TRACE ID: ${params.trace.traceId}`,
    `**CRITICAL**: You MUST use this exact traceId for ALL tool calls. Do NOT create or invent a traceId.`,
    '',
    `CURRENT OWNER: ${params.trace.currentOwner || 'casey'}`,
    params.projectContext.name
      ? `PROJECT (${params.projectContext.name}): ${params.projectContext.description || ''}`
      : '',
    params.projectContext.guardrails
      ? `PROJECT GUARDRAILS:\n${formatGuardrails(params.projectContext.guardrails)}`
      : '',
    `INSTRUCTIONS: ${params.instructions || 'None provided yet.'}`,
    `UPSTREAM WORK:\n${params.memoryLines}`,
    'CRITICAL PROTOCOL:',
    '1. Load memories using memory_search if needed (use traceId from above)',
    `2. Store your work using memory_store with traceId="${params.trace.traceId}"`,
    `3. **REQUIRED**: You MUST call handoff_to_agent tool with traceId="${params.trace.traceId}"`,
    '   - Do NOT just store a memory saying "handoff to X" - you MUST actually call the handoff_to_agent tool',
    `   - Example: handoff_to_agent({traceId: "${params.trace.traceId}", toAgent: "riley", instructions: "Write scripts for..."})`,
    '   - **NEVER** create or invent a traceId - always use the traceId provided above',
    '   - For Quinn: call handoff_to_agent with toAgent="complete" after publishing',
    '   - If error: call handoff_to_agent with toAgent="error"',
  ];

  return promptPieces.filter(Boolean).join('\n\n');
}

/**
 * Derives the allowed tools for a persona based on configuration and project context
 */
export function deriveAllowedTools(params: {
  personaName: string;
  personaMeta: Record<string, unknown>;
  personaConfig: { name: string; allowedTools?: string[] };
  projectKnown: boolean;
}): string[] {
  // First check persona.allowedTools (from database schema)
  const fromPersona =
    Array.isArray(params.personaConfig.allowedTools) && params.personaConfig.allowedTools.length > 0
      ? [...params.personaConfig.allowedTools]
      : null;

  // Fallback to metadata.allowedTools (legacy support)
  const fromMetadata =
    !fromPersona && Array.isArray(params.personaMeta.allowedTools)
      ? (params.personaMeta.allowedTools as string[])
      : null;

  // Default tools if neither source provides them
  const baseAllowed = fromPersona || fromMetadata || ['memory_search', 'memory_store', 'handoff_to_agent'];
  const allowed: string[] = [...baseAllowed];

  // Ensure handoff_to_agent is always included
  if (!allowed.includes('handoff_to_agent')) {
    allowed.push('handoff_to_agent');
  }

  // Project-specific tools (these are added dynamically based on project, not stored in persona)
  if (params.projectKnown && (params.personaName === 'veo' || params.personaName === 'alex')) {
    if (!allowed.includes('job_upsert')) {
      allowed.push('job_upsert');
    }
    if (!allowed.includes('jobs_summary')) {
      allowed.push('jobs_summary');
    }
  }

  if (params.projectKnown && params.personaName === 'quinn') {
    if (!allowed.includes('workflow_complete')) {
      allowed.push('workflow_complete');
    }
  }

  return Array.from(new Set(allowed));
}

/**
 * Formats memory lines for display in prompts
 */
function formatMemoryLines(memories: Array<Record<string, unknown>>): string {
  if (memories.length === 0) {
    return 'none logged yet (you will store the first entry).';
  }

  return memories
    .slice(0, 10)
    .map((memory, index) => {
      const base =
        typeof memory.content === 'string' && memory.content.trim().length > 0
          ? memory.content.trim()
          : typeof memory.summary === 'string' && memory.summary.trim().length > 0
          ? memory.summary.trim()
          : `[${memory.persona || 'memory'}]`;
      return `${index + 1}. ${base}`;
    })
    .join('\n');
}

/**
 * Core trace preparation logic shared between MCP tool and HTTP endpoint
 */
export async function prepareTraceContext(params: TracePrepParams): Promise<TracePrepResult> {
  const traceRepo = new TraceRepository();
  const memoryLimit = params.memoryLimit ?? DEFAULT_MEMORY_LIMIT;
  const defaultInstructions =
    params.instructions?.trim() ||
    'User opened a new production run. Gather context, set the correct project, and brief Iggy.';

  let trace: Trace | null = null;
  let justCreated = false;

  // Get or create trace
  if (params.traceId) {
    trace = await traceRepo.getTrace(params.traceId);
    if (!trace) {
      throw new Error(`Trace not found: ${params.traceId}`);
    }
  } else {
    trace = await traceRepo.create({
      projectId: 'unknown',
      sessionId: params.sessionId,
      metadata: {
        ...(params.metadata || {}),
        source: params.source || 'unknown',
      },
      instructions: defaultInstructions,
    });
    justCreated = true;
  }

  // If existing trace has empty instructions but workflow supplied a message, persist it.
  if (!justCreated && (!trace.instructions || !trace.instructions.trim()) && params.instructions) {
    const updated = await traceRepo.updateTrace(trace.traceId, {
      instructions: params.instructions,
    });
    trace = updated ?? trace;
  }

  // Load persona
  const personaName = (trace.currentOwner || 'casey').toLowerCase();
  let personaResult;
  try {
    personaResult = await getPersona({ personaName });
  } catch (error) {
    if (personaName !== 'casey') {
      personaResult = await getPersona({ personaName: 'casey' });
    } else {
      throw error;
    }
  }

  // Load project context
  let projectContext: {
    id: string;
    name: string;
    description: string;
    guardrails: Record<string, unknown> | string;
    settings: Record<string, unknown>;
  } | null = null;

  if (trace.projectId && trace.projectId !== 'unknown') {
    try {
      const projectResult = await getProject({ projectName: trace.projectId });
      projectContext = {
        id: trace.projectId,
        name: projectResult.project.name,
        description: projectResult.project.description,
        guardrails: projectResult.project.guardrails,
        settings: projectResult.project.settings,
      };
    } catch (error) {
      logger.warn({
        msg: 'Failed to load project guardrails; continuing with fallback',
        projectId: trace.projectId,
        error: (error as Error).message,
      });
    }
  }

  if (!projectContext) {
    projectContext = {
      id: 'unknown',
      name: 'unknown',
      description: 'Project not set. Casey must call set_project before handing off to Iggy.',
      guardrails: {
        reminder: 'Casey: determine if this is AISMR or GenReact and update the trace before ideation.',
      },
      settings: {},
    };
  }

  // Load memories
  // Note: query is required by type but not used when traceId is provided (fast path)
  const memoryResult = await searchMemories({
    query: '', // Not used when traceId is provided
    traceId: trace.traceId,
    project: trace.projectId !== 'unknown' ? trace.projectId : undefined,
    limit: memoryLimit,
  });
  const memories = (memoryResult.memories || []).map((memory) => stripEmbeddings(memory));
  const memoryLines = formatMemoryLines(memories);

  const effectiveInstructions =
    trace.instructions && trace.instructions.trim().length > 0
      ? trace.instructions.trim()
      : params.instructions?.trim() || '';

  // Load available projects if Casey needs to select one
  let availableProjects: Array<{ id: string; name: string; description: string }> | undefined;
  const isProjectKnown = trace.projectId && trace.projectId !== 'unknown';
  
  if (!isProjectKnown) {
    // Casey is active and needs to know available projects
    try {
      const projectRepo = new ProjectRepository();
      const allProjects = await projectRepo.findAll();
      availableProjects = allProjects.map((p) => ({
        id: p.name, // Use 'name' as the ID (e.g., 'aismr', 'genreact')
        name: p.name,
        description: p.description,
      }));
    } catch (error) {
      logger.warn({
        msg: 'Failed to load available projects for Casey',
        error: (error as Error).message,
      });
      availableProjects = [];
    }
  }

  // Build system prompt
  const systemPrompt = isProjectKnown
    ? buildPersonaPrompt({
        personaPrompt: personaResult.persona.systemPrompt,
        trace,
        projectContext,
        instructions: effectiveInstructions,
        memoryLines,
      })
    : buildCaseyPrompt({
        instructions: effectiveInstructions || defaultInstructions,
        memoryLines,
        availableProjects: availableProjects || [],
        traceId: trace.traceId,
      });

  // Derive allowed tools
  const allowedTools = deriveAllowedTools({
    personaName,
    personaMeta: personaResult.metadata,
    personaConfig: personaResult.persona,
    projectKnown: Boolean(isProjectKnown),
  });

  // Build response payload
  // Note: We don't return the full memories array to avoid unnecessary payload size.
  // The memorySummary (formatted memory lines) is what's actually used in the prompt.
  // Embeddings are stripped from memories before they're used, but we don't return them anyway.
  return {
    trace: {
      traceId: trace.traceId,
      projectId: trace.projectId,
      currentOwner: trace.currentOwner,
      status: trace.status,
      instructions: trace.instructions,
      workflowStep: trace.workflowStep,
      sessionId: trace.sessionId,
      metadata: trace.metadata,
    },
    traceId: trace.traceId,
    justCreated,
    persona: personaResult.persona,
    personaMetadata: personaResult.metadata,
    project: projectContext,
    ...(availableProjects ? { availableProjects } : {}),
    memorySummary: memoryLines,
    systemPrompt,
    allowedTools,
    instructions: effectiveInstructions || defaultInstructions,
  };
}

