import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  index,
  uniqueIndex,
  check,
  customType,
  pgEnum,
  foreignKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Enable pgvector extension
export const enablePgvector = sql`CREATE EXTENSION IF NOT EXISTS vector`;

// Memory type enum
export const memoryTypeEnum = pgEnum('memory_type', [
  'episodic',
  'semantic',
  'procedural',
]);

// Trace status enum
export const traceStatusEnum = pgEnum('trace_status', [
  'active',
  'completed',
  'failed',
]);

// Persona name enum
export const personaNameEnum = pgEnum('persona_name', [
  'casey',
  'iggy',
  'riley',
  'veo',
  'alex',
  'quinn',
]);

// Workflow run status enum
export const workflowRunStatusEnum = pgEnum('workflow_run_status', [
  'running',
  'completed',
  'failed',
  'canceled',
]);

// HTTP method enum
export const httpMethodEnum = pgEnum('http_method', [
  'GET',
  'POST',
  'PUT',
  'DELETE',
  'PATCH',
]);

// Auth type enum
export const authTypeEnum = pgEnum('auth_type_enum', [
  'none',
  'header',
  'basic',
  'bearer',
]);

const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return 'vector(1536)';
  },
  toDriver(value) {
    return `[${value.join(',')}]`;
  },
  fromDriver(value) {
    if (typeof value === 'string') {
      return value
        .replace('[', '')
        .replace(']', '')
        .split(',')
        .filter(Boolean)
        .map(Number);
    }
    return value as number[];
  },
});

export const jobStatusEnum = pgEnum('job_status', [
  'queued',
  'running',
  'succeeded',
  'failed',
  'canceled',
]);

// Memories table
export const memories = pgTable(
  'memories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    content: text('content').notNull(),
    summary: text('summary'),
    embedding: vector('embedding').notNull(),
    memoryType: memoryTypeEnum('memory_type').notNull(),

    persona: text('persona').array().notNull().default(sql`ARRAY[]::text[]`),
    project: text('project').array().notNull().default(sql`ARRAY[]::text[]`),
    tags: text('tags').array().notNull().default(sql`ARRAY[]::text[]`),
    relatedTo: uuid('related_to')
      .array()
      .notNull()
      .default(sql`ARRAY[]::uuid[]`),

    traceId: uuid('trace_id'),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    lastAccessedAt: timestamp('last_accessed_at'),
    accessCount: integer('access_count').notNull().default(0),

    metadata: jsonb('metadata').notNull().default({}),
  },
  (table) => ({
    // Vector index - HNSW for optimal performance
    embeddingIdx: index('memories_embedding_idx').using(
      'hnsw',
      sql`${table.embedding} vector_cosine_ops`
    ),

    // Metadata indices
    memoryTypeIdx: index('memories_memory_type_idx').on(table.memoryType),
    personaIdx: index('memories_persona_idx').using('gin', table.persona),
    projectIdx: index('memories_project_idx').using('gin', table.project),
    tagsIdx: index('memories_tags_idx').using('gin', table.tags),
    relatedToIdx: index('memories_related_to_idx').using('gin', table.relatedTo),
    temporalIdx: index('memories_created_at_idx').on(table.createdAt),
    traceIdIdx: index('memories_trace_id_idx').on(table.traceId),

    // Foreign key to execution_traces will be added in migration SQL
    // (executionTraces is defined later in this file)

    // Check constraints - enforce single-line content
    contentNoNewlines: check('content_no_newlines', sql`content !~ E'\\n'`),
    summaryNoNewlines: check(
      'summary_no_newlines',
      sql`summary IS NULL OR summary !~ E'\\n'`
    ),
  })
);

// Personas table
export const personas = pgTable('personas', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  description: text('description').notNull(),
  capabilities: text('capabilities').array().notNull(),
  tone: text('tone').notNull(),
  defaultProject: text('default_project'),
  systemPrompt: text('system_prompt'),
  allowedTools: text('allowed_tools').array().notNull().default(sql`ARRAY[]::text[]`),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Projects table
export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  description: text('description').notNull(),
  workflow: text('workflow').array().notNull().default(sql`ARRAY[]::text[]`),
  optionalSteps: text('optional_steps').array().notNull().default(sql`ARRAY[]::text[]`),
  guardrails: jsonb('guardrails').notNull().default({}),
  settings: jsonb('settings').notNull().default({}),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Sessions table
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    persona: text('persona').notNull(),
    project: text('project').notNull(),
    lastInteractionAt: timestamp('last_interaction_at').notNull().defaultNow(),
    expiresAt: timestamp('expires_at'),
    context: jsonb('context').notNull().default({}),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index('sessions_user_idx').on(table.userId),
    expiresAtIdx: index('sessions_expires_at_idx').on(table.expiresAt),
    // Foreign keys to personas and projects (by name, not UUID)
    personaFk: foreignKey({
      columns: [table.persona],
      foreignColumns: [personas.name],
      name: 'sessions_persona_fk',
    }).onDelete('restrict'),
    projectFk: foreignKey({
      columns: [table.project],
      foreignColumns: [projects.name],
      name: 'sessions_project_fk',
    }).onDelete('restrict'),
  })
);

// Workflow runs table
export const workflowRuns = pgTable(
  'workflow_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: text('session_id'),
    workflowName: text('workflow_name').notNull(),
    status: workflowRunStatusEnum('status').notNull(),
    input: jsonb('input'),
    output: jsonb('output'),
    error: text('error'),
    startedAt: timestamp('started_at').notNull().defaultNow(),
    completedAt: timestamp('completed_at'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    workflowSessionIdx: index('workflow_runs_session_idx').on(table.sessionId),
    // Foreign key to sessions
    sessionIdFk: foreignKey({
      columns: [table.sessionId],
      foreignColumns: [sessions.id],
      name: 'workflow_runs_session_id_fk',
    }).onDelete('cascade'),
    startedAtLteCompletedAt: check(
      'workflow_runs_started_at_lte_completed_at',
      sql`${table.startedAt} <= ${table.completedAt} OR ${table.completedAt} IS NULL`
    ),
  })
);

// Execution traces table - coordinates agent handoffs via traceId
export const executionTraces = pgTable(
  'execution_traces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    traceId: uuid('trace_id').notNull().unique(),
    projectId: uuid('project_id'),
    sessionId: text('session_id'),
    // Ownership and workflow coordination
    currentOwner: text('current_owner').notNull().default('casey'),
    previousOwner: text('previous_owner'),
    instructions: text('instructions').notNull().default(''),
    workflowStep: integer('workflow_step').notNull().default(0),
    status: traceStatusEnum('status').notNull().default('active'),
    outputs: jsonb('outputs'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    completedAt: timestamp('completed_at'),
    metadata: jsonb('metadata').notNull().default({}),
  },
  (table) => ({
    traceIdIdx: index('execution_traces_trace_id_idx').on(table.traceId),
    statusIdx: index('execution_traces_status_idx').on(table.status),
    currentOwnerIdx: index('execution_traces_current_owner_idx').on(
      table.currentOwner
    ),
    createdAtIdx: index('execution_traces_created_at_idx').on(table.createdAt),
    // Covering index for active traces by project
    statusProjectIdx: index('execution_traces_status_project_idx')
      .on(table.status, table.projectId)
      .where(sql`${table.status} = 'active'`),
    // Foreign keys
    projectIdFk: foreignKey({
      columns: [table.projectId],
      foreignColumns: [projects.id],
      name: 'execution_traces_project_id_fk',
    }).onDelete('restrict'),
    sessionIdFk: foreignKey({
      columns: [table.sessionId],
      foreignColumns: [sessions.id],
      name: 'execution_traces_session_id_fk',
    }).onDelete('set null'),
    currentOwnerFk: foreignKey({
      columns: [table.currentOwner],
      foreignColumns: [personas.name],
      name: 'execution_traces_current_owner_fk',
    }).onDelete('restrict'),
    workflowStepNonNegative: check(
      'execution_traces_workflow_step_non_negative',
      sql`${table.workflowStep} >= 0`
    ),
  })
);

// Agent webhooks table - maps agent names to n8n webhook configurations
export const agentWebhooks = pgTable(
  'agent_webhooks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentName: text('agent_name').notNull().unique(),
    webhookPath: text('webhook_path').notNull(),
    method: httpMethodEnum('method').notNull().default('POST'),
    authType: authTypeEnum('auth_type').notNull().default('none'),
    authConfig: jsonb('auth_config').notNull().default({}),
    description: text('description'),
    isActive: boolean('is_active').notNull().default(true),
    timeoutMs: integer('timeout_ms'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    agentNameIdx: index('agent_webhooks_agent_name_idx').on(table.agentName),
    isActiveIdx: index('agent_webhooks_is_active_idx').on(table.isActive),
  })
);

// Video generation jobs table
export const videoGenerationJobs = pgTable(
  'video_generation_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    traceId: uuid('trace_id').notNull(),
    scriptId: uuid('script_id'),
    provider: text('provider').notNull(),
    taskId: text('task_id').notNull(),
    status: jobStatusEnum('status').notNull().default('queued'),
    assetUrl: text('asset_url'),
    error: text('error'),
    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    traceIdx: index('video_generation_jobs_trace_idx').on(table.traceId),
    statusIdx: index('video_generation_jobs_status_idx').on(table.status),
    // Covering index for trace_id + status queries
    traceStatusIdx: index('video_generation_jobs_trace_status_idx').on(
      table.traceId,
      table.status
    ),
    providerTaskIdx: uniqueIndex('video_generation_jobs_provider_task_idx').on(
      table.provider,
      table.taskId
    ),
    // Foreign key to execution_traces
    traceIdFk: foreignKey({
      columns: [table.traceId],
      foreignColumns: [executionTraces.traceId],
      name: 'video_generation_jobs_trace_id_fk',
    }).onDelete('cascade'),
    // Check constraints for job state machine
    completedAtRequiredForTerminal: check(
      'video_generation_jobs_completed_at_required',
      sql`(${table.status} NOT IN ('succeeded', 'failed')) OR ${table.completedAt} IS NOT NULL`
    ),
    startedAtLteCompletedAt: check(
      'video_generation_jobs_started_at_lte_completed_at',
      sql`${table.startedAt} IS NULL OR ${table.completedAt} IS NULL OR ${table.startedAt} <= ${table.completedAt}`
    ),
  })
);

// Edit jobs table
export const editJobs = pgTable(
  'edit_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    traceId: uuid('trace_id').notNull(),
    provider: text('provider').notNull(),
    taskId: text('task_id').notNull(),
    status: jobStatusEnum('status').notNull().default('queued'),
    finalUrl: text('final_url'),
    error: text('error'),
    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    traceIdx: index('edit_jobs_trace_idx').on(table.traceId),
    // Covering index for trace_id + status queries
    traceStatusIdx: index('edit_jobs_trace_status_idx').on(
      table.traceId,
      table.status
    ),
    providerTaskIdx: uniqueIndex('edit_jobs_provider_task_idx').on(
      table.provider,
      table.taskId
    ),
    // Foreign key to execution_traces
    traceIdFk: foreignKey({
      columns: [table.traceId],
      foreignColumns: [executionTraces.traceId],
      name: 'edit_jobs_trace_id_fk',
    }).onDelete('cascade'),
    // Check constraints for job state machine
    completedAtRequiredForTerminal: check(
      'edit_jobs_completed_at_required',
      sql`(${table.status} NOT IN ('succeeded', 'failed')) OR ${table.completedAt} IS NOT NULL`
    ),
    startedAtLteCompletedAt: check(
      'edit_jobs_started_at_lte_completed_at',
      sql`${table.startedAt} IS NULL OR ${table.completedAt} IS NULL OR ${table.startedAt} <= ${table.completedAt}`
    ),
  })
);

// Retry queue for failed memory operations
export const retryQueue = pgTable(
  'retry_queue',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    task: text('task').notNull(), // 'memory_store'
    payload: jsonb('payload').notNull(), // Serialized operation parameters
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    nextRetry: timestamp('next_retry').notNull(),
    lastError: text('last_error'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    nextRetryIdx: index('retry_queue_next_retry_idx').on(table.nextRetry),
    taskIdx: index('retry_queue_task_idx').on(table.task),
  })
);

// Workflow mappings table - maps human-readable workflow keys to n8n workflow IDs
export const workflowMappings = pgTable(
  'workflow_mappings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workflowKey: text('workflow_key').notNull().unique(), // e.g., 'upload-google-drive'
    workflowId: text('workflow_id').notNull(), // n8n workflow ID (instance-specific)
    workflowName: text('workflow_name').notNull(), // Human-readable name
    environment: text('environment').notNull().default('production'), // 'production', 'staging', 'development'
    description: text('description'),
    isActive: boolean('is_active').notNull().default(true),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    workflowKeyIdx: index('workflow_mappings_workflow_key_idx').on(table.workflowKey),
    environmentIdx: index('workflow_mappings_environment_idx').on(table.environment),
    isActiveIdx: index('workflow_mappings_is_active_idx').on(table.isActive),
    // Unique constraint on workflowKey + environment
    workflowKeyEnvironmentIdx: uniqueIndex('workflow_mappings_key_env_idx').on(
      table.workflowKey,
      table.environment
    ),
  })
);
