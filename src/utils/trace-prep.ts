import { TraceRepository, ProjectRepository } from '../db/repositories/index.js';
import type { Trace } from '../db/repositories/trace-repository.js';
import { getPersona } from '../tools/context/getPersonaTool.js';
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
    projectId: string | null;
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
    id: string | null;
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
  defaultProjectName: string;
}): string {
  const projectList = params.availableProjects
    .map((p) => `- ${p.id} (${p.name}): ${p.description}`)
    .join('\n');

  const caseyTasks = [
    'You are Casey, the Showrunner.',
    `TRACE ID: ${params.traceId}`,
    `**CRITICAL**: You MUST use this exact traceId for ALL tool calls. Do NOT create or invent a traceId.`,
    '',
    `USER MESSAGE: ${params.instructions || 'User opened a chat without providing additional instructions yet.'}`,
    'TASK:',
    `1. Decide if this request maps to a specific project with at least 90% confidence. If not, remain in ${params.defaultProjectName}.`,
    `2. If confident, call set_project({traceId: "${params.traceId}", projectId: "<project-id>"}) using the project id from the list below. Otherwise stay in ${params.defaultProjectName} and continue.`,
    `3. **REQUIRED**: You MUST call handoff_to_agent tool with traceId="${params.traceId}" and the appropriate persona once you're ready to hand off.`,
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
  projectContext: { name: string; description?: string; guardrails?: unknown; id?: string };
  instructions: string;
  memoryLines: string;
  inferredProject?: { id: string; slug: string } | null;
  availableProjects?: Array<{ id: string; name: string; description: string }>;
}): string {
  const isCasey = (params.trace.currentOwner || 'casey').toLowerCase() === 'casey';
  
  const promptPieces = [
    params.personaPrompt || `You are ${params.trace.currentOwner || 'an AISMR agent'}.`,
    `TRACE ID: ${params.trace.traceId}`,
    `**CRITICAL**: You MUST use this exact traceId for ALL tool calls. Do NOT create or invent a traceId.`,
    '',
    `CURRENT OWNER: ${params.trace.currentOwner || 'casey'}`,
    params.projectContext.name
      ? `PROJECT (${params.projectContext.name}): ${params.projectContext.description || ''}`
      : '',
    params.projectContext.id
      ? `PROJECT UUID: ${params.projectContext.id}`
      : '',
    params.projectContext.guardrails
      ? `PROJECT GUARDRAILS:\n${formatGuardrails(params.projectContext.guardrails)}`
      : '',
    `INSTRUCTIONS: ${params.instructions || 'None provided yet.'}`,
    `UPSTREAM WORK:\n${params.memoryLines}`,
  ];

  // Casey-specific protocol when project is already set
  if (isCasey) {
    const isGenericProject = 
      params.projectContext.name?.toLowerCase() === 'conversation' ||
      params.projectContext.name?.toLowerCase() === 'general';
    
    const hasInferredProject = params.inferredProject !== null && params.inferredProject !== undefined;
    // Show alignment check if project is generic and we have available projects to choose from
    const shouldCheckAlignment = isGenericProject && params.availableProjects && params.availableProjects.length > 0;

    if (shouldCheckAlignment) {
      const projectList = params.availableProjects
        .map((p) => `- ${p.id} (${p.name}): ${p.description}`)
        .join('\n');
      
      promptPieces.push(
        'YOUR WORKFLOW:',
        `1. **CRITICAL**: Check project alignment - Current project is "${params.projectContext.name}" (generic/conversation fallback)`,
        '   - Review the user instructions above and compare them to available projects below',
        '   - If the user intent clearly matches a specific project (≥90% confidence), call set_project to switch before handing off',
        `   - Example: set_project({traceId: "${params.trace.traceId}", projectId: "<project-id>"})`,
        '   - Only proceed to handoff after confirming the correct project is set',
        '',
        'Available projects:',
        projectList || 'No projects available.',
        '',
        '2. Determine which agent to hand off to based on the project workflow',
        '3. Call context_get_persona to understand what the next agent needs',
        `4. **REQUIRED**: Call handoff_to_agent with traceId="${params.trace.traceId}" and clear instructions`,
        '   - Do NOT just store a memory - you MUST actually call the handoff_to_agent tool',
        `   - Example: handoff_to_agent({traceId: "${params.trace.traceId}", toAgent: "iggy", instructions: "Generate 12 modifiers..."})`,
        '   - **NEVER** create or invent a traceId - always use the traceId provided above'
      );
    } else {
      promptPieces.push(
        'YOUR WORKFLOW:',
        '1. Project is already set (see PROJECT above) - no need to call context_get_project or set_project',
        '2. Determine which agent to hand off to based on the project workflow',
        '3. Call context_get_persona to understand what the next agent needs',
        `4. **REQUIRED**: Call handoff_to_agent with traceId="${params.trace.traceId}" and clear instructions`,
        '   - Do NOT just store a memory - you MUST actually call the handoff_to_agent tool',
        `   - Example: handoff_to_agent({traceId: "${params.trace.traceId}", toAgent: "iggy", instructions: "Generate 12 modifiers..."})`,
        '   - **NEVER** create or invent a traceId - always use the traceId provided above'
      );
    }
  } else {
    // Other personas
    promptPieces.push(
      'CRITICAL PROTOCOL:',
      '1. Load memories using memory_search if needed (use traceId from above)',
      `2. Store your work using memory_store with traceId="${params.trace.traceId}"`,
      `3. **REQUIRED**: You MUST call handoff_to_agent tool with traceId="${params.trace.traceId}"`,
      '   - Do NOT just store a memory saying "handoff to X" - you MUST actually call the handoff_to_agent tool',
      `   - Example: handoff_to_agent({traceId: "${params.trace.traceId}", toAgent: "riley", instructions: "Write scripts for..."})`,
      '   - **NEVER** create or invent a traceId - always use the traceId provided above',
      '   - For Quinn: call handoff_to_agent with toAgent="complete" after publishing',
      '   - If error: call handoff_to_agent with toAgent="error"'
    );
  }

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

interface ResolveProjectParams {
  instructions?: string;
  projectRepo: ProjectRepository;
}

interface ResolvedProject {
  id: string;
  slug: string;
  name: string;
  description: string;
  guardrails: Record<string, unknown>;
  settings: Record<string, unknown>;
}

async function resolveInitialProject({
  instructions,
  projectRepo,
}: ResolveProjectParams): Promise<{
  inferredProject: { id: string; slug: string } | null;
  fallbackProject: ResolvedProject | null;
  projects: ResolvedProject[];
  projectMap: Map<string, ResolvedProject>;
}> {
  const projectsRaw = await projectRepo.findAll();
  const rawById = new Map(projectsRaw.map((p) => [p.id, p]));
  const projects: ResolvedProject[] = projectsRaw.map((project) => ({
    id: project.id,
    slug: project.id,
    name: project.name,
    description: project.description,
    guardrails: project.guardrails,
    settings: project.settings,
  }));

  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const fallback =
    projects.find((p) => rawById.get(p.id)?.name.toLowerCase() === 'general') ??
    projects.find((p) => (rawById.get(p.id)?.workflow || []).includes('conversation')) ??
    null;

  const inferredSlug = instructions ? inferProjectSlug(instructions, projectsRaw) : null;
  const inferredProject =
    inferredSlug && projectsRaw.some((p) => p.name === inferredSlug.slug)
      ? {
          id: projectsRaw.find((p) => p.name === inferredSlug.slug)!.id,
          slug: projectsRaw.find((p) => p.name === inferredSlug.slug)!.id,
        }
      : null;

  return {
    inferredProject,
    fallbackProject: fallback,
    projects,
    projectMap,
  };
}

function inferProjectSlug(
  instructions: string,
  projects: Array<{ name: string }>
): { slug: string; confidence: number } | null {
  const normalized = instructions.toLowerCase();

  const keywordMap: Record<string, string[]> = {
    aismr: ['aismr', 'modifier', 'surreal', 'tiktok', 'screenplay', 'video'],
    genreact: ['genreact', 'generation', 'reaction', 'react video'],
    test_video_gen: ['test video', 'sandbox', 'test run'],
  };

  let best: { slug: string; confidence: number } | null = null;

  Object.entries(keywordMap).forEach(([slug, keywords]) => {
    let score = 0;
    if (normalized.includes(slug)) {
      score = 1;
    } else {
      const hits = keywords.filter((keyword) => normalized.includes(keyword)).length;
      if (hits >= 2) {
        score = 0.95;
      } else if (hits === 1) {
        score = 0.6;
      }
    }

    if (score >= 0.9) {
      if (!best || score > best.confidence) {
        best = { slug, confidence: score };
      } else if (best && score === best.confidence) {
        best = null;
      }
    }
  });

  if (!best) {
    return null;
  }

  return best;
}

/**
 * Core trace preparation logic shared between MCP tool and HTTP endpoint
 */
export async function prepareTraceContext(params: TracePrepParams): Promise<TracePrepResult> {
  const traceRepo = new TraceRepository();
  const projectRepo = new ProjectRepository();
  const memoryLimit = params.memoryLimit ?? DEFAULT_MEMORY_LIMIT;
  const defaultInstructions =
    params.instructions?.trim() ||
    'User opened a new production run. Gather context, set the correct project, and brief Iggy.';

  const {
    inferredProject,
    fallbackProject,
    projects,
    projectMap,
  } = await resolveInitialProject({
    instructions: params.instructions,
    projectRepo,
  });

  let trace: Trace | null = null;
  let justCreated = false;

  // Get or create trace
  if (params.traceId) {
    trace = await traceRepo.getTrace(params.traceId);
    if (!trace) {
      throw new Error(`Trace not found: ${params.traceId}`);
    }
    if (!trace.projectId && fallbackProject) {
      const updated = await traceRepo.updateTrace(trace.traceId, {
        projectId: fallbackProject.id,
      });
      trace = updated ?? trace;
    }
  } else {
    const selectedProjectId = (inferredProject ?? fallbackProject)?.id ?? null;
    trace = await traceRepo.create({
      sessionId: params.sessionId,
      projectId: selectedProjectId,
      metadata: {
        ...(params.metadata || {}),
        source: params.source || 'unknown',
        ...(inferredProject ? { autoProject: inferredProject.slug } : {}),
        ...(selectedProjectId === fallbackProject?.id && !inferredProject
          ? { autoProjectFallback: true }
          : {}),
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
    id: string | null;
    name: string;
    description: string;
    guardrails: Record<string, unknown> | string;
    settings: Record<string, unknown>;
  } | null = null;

  let memoryProjectFilter: string | undefined;

  if (trace.projectId) {
    try {
      const projectRecord =
        projectMap.get(trace.projectId) ?? (await projectRepo.findById(trace.projectId));
      if (projectRecord) {
        projectContext = {
          id: projectRecord.id,
          name: projectRecord.name,
          description: projectRecord.description,
          guardrails: projectRecord.guardrails,
          settings: projectRecord.settings,
        };
        memoryProjectFilter = projectRecord.name;
      } else {
        logger.warn({
          msg: 'Project referenced by trace not found; continuing with fallback',
          projectId: trace.projectId,
        });
      }
    } catch (error) {
      logger.warn({
        msg: 'Failed to load project guardrails; continuing with fallback',
        projectId: trace.projectId,
        error: (error as Error).message,
      });
    }
  }

  if (!projectContext) {
    if (fallbackProject) {
      projectContext = {
        id: fallbackProject.id,
        name: fallbackProject.name,
        description: fallbackProject.description,
        guardrails: fallbackProject.guardrails,
        settings: fallbackProject.settings,
      };
      memoryProjectFilter = fallbackProject.name;
      if (!trace.projectId) {
        const updated = await traceRepo.updateTrace(trace.traceId, {
          projectId: fallbackProject.id,
        });
        trace = updated ?? trace;
      }
    } else {
      projectContext = {
        id: null,
        name: 'conversation',
        description: 'Project not set. Casey must call set_project before handing off to Iggy.',
        guardrails: {
          reminder: 'Casey: determine if this is AISMR or GenReact and update the trace before ideation.',
        },
        settings: {},
      };
    }
  }

  // Load memories
  // Note: query is required by type but not used when traceId is provided (fast path)
  const memoryResult = await searchMemories({
    query: '', // Not used when traceId is provided
    traceId: trace.traceId,
    project: memoryProjectFilter,
    limit: memoryLimit,
  });
  const memories = (memoryResult.memories || []).map((memory) => stripEmbeddings(memory));
  const memoryLines = formatMemoryLines(memories);

  const effectiveInstructions =
    trace.instructions && trace.instructions.trim().length > 0
      ? trace.instructions.trim()
      : params.instructions?.trim() || '';

  // Load available projects if Casey needs to select one
  // Include projects when: (1) project is unknown, OR (2) project is generic (conversation/general)
  let availableProjects: Array<{ id: string; name: string; description: string }> | undefined;
  const isProjectKnown = Boolean(projectContext.id);
  const isGenericProject = 
    projectContext.name?.toLowerCase() === 'conversation' ||
    projectContext.name?.toLowerCase() === 'general';
  const needsProjectList = !isProjectKnown || isGenericProject;
  
  if (needsProjectList) {
    availableProjects = projects.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
    }));
  }

  // Build system prompt
  const systemPrompt = isProjectKnown
    ? buildPersonaPrompt({
        personaPrompt: personaResult.persona.systemPrompt,
        trace,
        projectContext: {
          ...projectContext,
          id: projectContext.id || undefined,
        },
        instructions: effectiveInstructions,
        memoryLines,
        inferredProject,
        availableProjects: availableProjects || [],
      })
    : buildCaseyPrompt({
        instructions: effectiveInstructions || defaultInstructions,
        memoryLines,
        availableProjects: availableProjects || [],
        traceId: trace.traceId,
        defaultProjectName: fallbackProject?.name ?? 'conversation',
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

