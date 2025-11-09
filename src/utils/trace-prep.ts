import { TraceRepository, ProjectRepository } from '../db/repositories/index.js';
import type { Trace } from '../db/repositories/trace-repository.js';
import { getPersona } from '../tools/context/getPersonaTool.js';
import { searchMemories } from '../tools/memory/searchTool.js';
import { stripEmbeddings } from './response-formatter.js';
import { logger } from './logger.js';
import { DEFAULT_MEMORY_LIMIT } from './constants.js';
import { readFile, readdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

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
    workflow?: string[];
    agentExpectations?: Record<string, unknown>;
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
  inferredProjectSlug?: string | null;
  inferredProjectConfidence?: number;
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
    `2. If confident, call trace_update({traceId: "${params.traceId}", projectId: "<project-id>"}) using the project id from the list below. Otherwise stay in ${params.defaultProjectName} and continue.`,
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

  if (params.inferredProjectSlug) {
    const confidenceText =
      typeof params.inferredProjectConfidence === 'number'
        ? ` (confidence ${(params.inferredProjectConfidence * 100).toFixed(0)}%)`
        : '';
    caseyTasks.splice(
      6,
      0,
      `SYSTEM HINT: This looks like the "${params.inferredProjectSlug}" project${confidenceText}. You still must call trace_update before handing off if you agree.`
    );
  }
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

type ProjectPlaybooks = {
  guardrails?: Record<string, unknown>;
  workflow?: string[];
  agentExpectations?: Record<string, unknown>;
  [key: string]: unknown;
};

/**
 * Loads ALL playbook files from data/projects/{slug}/
 */
export async function loadProjectPlaybooks(projectSlug: string): Promise<ProjectPlaybooks | null> {
  try {
    const playbookDir = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      'data',
      'projects',
      projectSlug,
    );

    const entries = await readdir(playbookDir, { withFileTypes: true });
    const jsonFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json'));

    if (jsonFiles.length === 0) {
      logger.debug({
        msg: 'Project playbook directory is empty',
        projectSlug,
        playbookDir,
      });
      return null;
    }

    const playbooks: ProjectPlaybooks = {};

    for (const file of jsonFiles) {
      const filePath = path.join(playbookDir, file.name);
      try {
        const content = await readFile(filePath, 'utf-8');
        const data = JSON.parse(content);
        const key = file.name.replace('.json', '');

        if (file.name === 'workflow.json' && Array.isArray(data.workflow)) {
          playbooks.workflow = data.workflow;
        } else if (file.name === 'agent-expectations.json' && data) {
          playbooks.agentExpectations = data;
        } else if (file.name === 'project.json') {
          if (!playbooks.workflow && Array.isArray(data.workflow)) {
            playbooks.workflow = data.workflow;
          }
          if (!playbooks.guardrails && data.guardrails) {
            playbooks.guardrails = data.guardrails;
          }
          if (!playbooks.agentExpectations && data.agentExpectations) {
            playbooks.agentExpectations = data.agentExpectations;
          }
          playbooks.project = data;
        } else if (file.name === 'guardrails.json') {
          playbooks.guardrails = data;
        } else {
          playbooks[key.replace(/-/g, '_')] = data;
        }
      } catch (error) {
        logger.debug({
          msg: 'Skipping playbook file',
          projectSlug,
          file: file.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (!playbooks.guardrails) {
      const guardrailDir = entries.find(
        (entry) => entry.isDirectory() && entry.name === 'guardrails',
      );
      if (guardrailDir) {
        try {
          const guardrailFiles = await readdir(path.join(playbookDir, guardrailDir.name));
          const grouped: Record<string, Array<Record<string, unknown>>> = {};
          for (const guardrailFile of guardrailFiles) {
            if (!guardrailFile.endsWith('.json')) continue;
            const guardrailPath = path.join(playbookDir, guardrailDir.name, guardrailFile);
            try {
              const raw = JSON.parse(await readFile(guardrailPath, 'utf-8')) as Record<
                string,
                unknown
              >;
              const category = (raw.category as string | undefined) ?? 'general';
              if (!grouped[category]) {
                grouped[category] = [];
              }
              grouped[category].push(raw);
            } catch (error) {
              logger.debug({
                msg: 'Skipping guardrail entry',
                projectSlug,
                file: guardrailFile,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
          if (Object.keys(grouped).length > 0) {
            playbooks.guardrails = grouped;
          }
        } catch (error) {
          logger.debug({
            msg: 'Failed to read guardrail directory',
            projectSlug,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    return Object.keys(playbooks).length > 0 ? playbooks : null;
  } catch (error) {
    logger.debug({
      msg: 'Project playbook directory not found',
      projectSlug,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Builds the persona-specific prompt for traces with a known project
 */
export async function buildPersonaPrompt(params: {
  personaPrompt: string | null;
  trace: Trace;
  projectContext: {
    name: string;
    description?: string;
    guardrails?: unknown;
    id?: string;
    workflow?: string[];
    agentExpectations?: Record<string, unknown>;
  };
  instructions: string;
  memoryLines: string;
  inferredProject?: { id: string; slug: string; confidence: number } | null;
  availableProjects?: Array<{ id: string; name: string; description: string }>;
}): Promise<string> {
  const personaName = (params.trace.currentOwner || 'casey').toLowerCase();
  const isCasey = personaName === 'casey';

  const playbooks = await loadProjectPlaybooks(params.projectContext.name);
  const workflow = params.projectContext.workflow || playbooks?.workflow || [];
  const caseyExpectations = playbooks?.agentExpectations?.casey as
    | { instructions_template?: string }
    | undefined;
  const instructionsTemplate = caseyExpectations?.instructions_template;
  
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
    `INSTRUCTIONS: ${params.instructions || 'None provided yet.'}`,
    `UPSTREAM WORK:\n${params.memoryLines}`,
  ];

  const guardrailsData = params.projectContext.guardrails;
  const hasGuardrails =
    typeof guardrailsData === 'string'
      ? guardrailsData.trim().length > 0
      : guardrailsData && typeof guardrailsData === 'object'
        ? Object.keys(guardrailsData as Record<string, unknown>).length > 0
        : false;
  if (hasGuardrails) {
    promptPieces.push(`PROJECT GUARDRAILS:\n${formatGuardrails(guardrailsData)}`);
  }

  if (!isCasey && params.projectContext.agentExpectations) {
    const expectations = (params.projectContext.agentExpectations as Record<string, unknown>)[
      personaName
    ];
    if (expectations) {
      promptPieces.push(`YOUR ROLE EXPECTATIONS:\n${formatGuardrails(expectations)}`);
    }
  }

  // Casey-specific protocol when project is already set
  if (isCasey) {
    const isGenericProject = 
      params.projectContext.name?.toLowerCase() === 'conversation' ||
      params.projectContext.name?.toLowerCase() === 'general';
    
    // Show alignment check if project is generic and we have available projects to choose from
    const shouldCheckAlignment = isGenericProject && params.availableProjects && params.availableProjects.length > 0;

    const firstAgent = workflow.length > 1 ? workflow[1] : 'iggy'; // workflow[0] is 'casey', so [1] is first agent

    // Pre-action checklist
    promptPieces.push(
      'PRE-ACTION CHECKLIST:',
      'Before taking any action, confirm:',
      `1. Project is correctly set: "${params.projectContext.name}"`,
      `2. First agent in workflow: ${firstAgent}`,
      '3. Use memory_search to understand context and what the first agent needs',
      `4. You will call handoff_to_agent with traceId="${params.trace.traceId}"`,
      ''
    );

    if (shouldCheckAlignment && params.availableProjects) {
      const projectList = params.availableProjects
        .map((p) => `- ${p.id} (${p.name}): ${p.description}`)
        .join('\n');
      
      promptPieces.push(
        'YOUR WORKFLOW:',
        `1. **CRITICAL**: Check project alignment - Current project is "${params.projectContext.name}" (generic/conversation fallback)`,
        '   - Review the user instructions above and compare them to available projects below',
        '   - If the user intent clearly matches a specific project (≥90% confidence), call trace_update to switch before handing off',
        `   - Example: trace_update({traceId: "${params.trace.traceId}", projectId: "<project-id>"})`,
        '   - Only proceed to handoff after confirming the correct project is set',
        '',
        'Available projects:',
        projectList || 'No projects available.',
        '',
        `2. **FIRST AGENT**: ${firstAgent} (from project workflow: ${workflow.join(' → ')})`,
        `3. Use memory_search to understand context and what ${firstAgent} needs`,
        `4. **REQUIRED**: Call handoff_to_agent with traceId="${params.trace.traceId}" and clear instructions`,
        '   - Do NOT just store a memory - you MUST actually call the handoff_to_agent tool',
        instructionsTemplate
          ? `   - HANDOFF TEMPLATE (from project): ${instructionsTemplate}`
          : `   - Example: handoff_to_agent({traceId: "${params.trace.traceId}", toAgent: "${firstAgent}", instructions: "Generate..."})`,
        '   - **NEVER** create or invent a traceId - always use the traceId provided above'
      );
    } else {
      promptPieces.push(
        'YOUR WORKFLOW:',
        '1. Project is already set (see PROJECT above) - no need to call trace_update unless switching projects',
        `2. **FIRST AGENT**: ${firstAgent} (from project workflow: ${workflow.join(' → ')})`,
        `3. Use memory_search to understand context and what ${firstAgent} needs`,
        `4. **REQUIRED**: Call handoff_to_agent with traceId="${params.trace.traceId}" and clear instructions`,
        '   - Do NOT just store a memory - you MUST actually call the handoff_to_agent tool',
        instructionsTemplate
          ? `   - HANDOFF TEMPLATE (from project): ${instructionsTemplate}`
          : `   - Example: handoff_to_agent({traceId: "${params.trace.traceId}", toAgent: "${firstAgent}", instructions: "Generate..."})`,
        '   - **NEVER** create or invent a traceId - always use the traceId provided above'
      );
    }

    // CRITICAL TOOL POLICY
    promptPieces.push(
      '',
      'CRITICAL TOOL POLICY:',
      'You are Casey, the Showrunner. Your ONLY job is to coordinate handoffs.',
      '',
      'ALLOWED TOOLS (MCP tools only):',
      '- trace_update: Update trace metadata and project',
      '- memory_search: Search memories by traceId',
      '- memory_store: Store memories',
      '- handoff_to_agent: Transfer ownership to next agent',
      '',
      'NEVER DO:',
      '- Never call tool workflows (Generate Video, Edit Compilation, Upload to TikTok, Upload to Drive)',
      '- These are persona-specific workflows - hand off to the owning persona instead',
      '- Never try to execute work yourself - your team handles execution',
      '- Never skip handoff - you MUST call handoff_to_agent tool',
      ''
    );
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
 * 
 * Core tool set per persona:
 * - casey: trace_update, memory_search, memory_store, handoff_to_agent
 * - iggy, riley: memory_search, memory_store, handoff_to_agent
 * - veo, alex: memory_search, memory_store, handoff_to_agent, workflow_trigger, jobs
 * - quinn: memory_search, memory_store, handoff_to_agent, workflow_trigger
 */
export function deriveAllowedTools(params: {
  personaName: string;
  personaMeta: Record<string, unknown>;
  personaConfig: { name: string; allowedTools?: string[] };
  projectKnown: boolean;
}): string[] {
  const personaName = params.personaName.toLowerCase();

  // Core tools for all personas
  const coreTools = ['memory_search', 'memory_store', 'handoff_to_agent'];

  // Casey gets trace_update (can update project via trace_update)
  if (personaName === 'casey') {
    return ['trace_update', ...coreTools];
  }

  // Veo and Alex get workflow_trigger and jobs
  if (personaName === 'veo' || personaName === 'alex') {
    return [...coreTools, 'workflow_trigger', 'jobs'];
  }

  // Quinn gets workflow_trigger
  if (personaName === 'quinn') {
    return [...coreTools, 'workflow_trigger'];
  }

  // Default for other personas (iggy, riley, etc.)
  return coreTools;
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
  workflow?: string[];
}

async function resolveInitialProject({
  instructions,
  projectRepo,
}: ResolveProjectParams): Promise<{
  inferredProject: { id: string; slug: string; confidence: number } | null;
  fallbackProject: ResolvedProject | null;
  projects: ResolvedProject[];
  projectMap: Map<string, ResolvedProject>;
}> {
  const projectsRaw = await projectRepo.findAll();
  const rawById = new Map(projectsRaw.map((p) => [p.id, p]));
  const projects: ResolvedProject[] = projectsRaw.map((project) => ({
    id: project.id,
    slug: project.name,
    name: project.name,
    description: project.description,
    guardrails: project.guardrails,
    settings: project.settings,
    workflow: project.workflow,
  }));

  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const fallback =
    projects.find((p) => rawById.get(p.id)?.name.toLowerCase() === 'general') ??
    projects.find((p) => (rawById.get(p.id)?.workflow || []).includes('conversation')) ??
    null;

  const inferredSlug = instructions ? inferProjectSlug(instructions) : null;
  let inferredProject: { id: string; slug: string; confidence: number } | null = null;
  if (inferredSlug) {
    const projectMatch = projectsRaw.find((p) => p.name === inferredSlug.slug);
    if (projectMatch) {
      inferredProject = {
        id: projectMatch.id,
        slug: projectMatch.name,
        confidence: inferredSlug.confidence,
      };
    }
  }

  return {
    inferredProject,
    fallbackProject: fallback,
    projects,
    projectMap,
  };
}

function inferProjectSlug(instructions: string): { slug: string; confidence: number } | null {
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
    trace = await traceRepo.create({
      sessionId: params.sessionId,
      projectId: null,
      metadata: {
        ...(params.metadata || {}),
        source: params.source || 'unknown',
        ...(inferredProject ? { autoProject: inferredProject.slug } : {}),
        ...(fallbackProject ? { autoProjectFallback: fallbackProject.slug } : {}),
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
    workflow?: string[];
    agentExpectations?: Record<string, unknown>;
  } | null = null;

  let memoryProjectFilter: string | undefined;

  if (trace.projectId) {
    try {
      const projectRecord =
        projectMap.get(trace.projectId) ?? (await projectRepo.findById(trace.projectId));
      if (projectRecord) {
        const playbooks = await loadProjectPlaybooks(projectRecord.name);
        projectContext = {
          id: projectRecord.id,
          name: projectRecord.name,
          description: projectRecord.description,
          guardrails: playbooks?.guardrails || projectRecord.guardrails,
          settings: projectRecord.settings,
          workflow: playbooks?.workflow || projectRecord.workflow,
          agentExpectations: playbooks?.agentExpectations,
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
    projectContext = {
      id: null,
      name: 'conversation',
      description:
        'Project not set. Casey must call trace_update to set project before handing off to Iggy.',
      guardrails: {
        reminder:
          'Casey: determine if this is AISMR or GenReact and update the trace before ideation.',
      },
      settings: {},
    };
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
    ? await buildPersonaPrompt({
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
        inferredProjectSlug: inferredProject?.slug,
        inferredProjectConfidence: inferredProject?.confidence,
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

