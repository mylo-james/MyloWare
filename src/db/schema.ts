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
    context: jsonb('context').notNull().default({}),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index('sessions_user_idx').on(table.userId),
  })
);

// Workflow runs table
export const workflowRuns = pgTable(
  'workflow_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: text('session_id'),
    workflowName: text('workflow_name').notNull(),
    status: text('status').notNull(),
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
  })
);

// Execution traces table - coordinates agent handoffs via traceId
export const executionTraces = pgTable(
  'execution_traces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    traceId: uuid('trace_id').notNull().unique(),
    projectId: text('project_id').notNull(),
    sessionId: text('session_id'),
    // Ownership and workflow coordination
    currentOwner: text('current_owner').notNull().default('casey'),
    previousOwner: text('previous_owner'),
    instructions: text('instructions').notNull().default(''),
    workflowStep: integer('workflow_step').notNull().default(0),
    status: text('status').notNull().default('active'), // 'active', 'completed', 'failed'
    outputs: jsonb('outputs'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
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
  })
);

// Agent webhooks table - maps agent names to n8n webhook configurations
export const agentWebhooks = pgTable(
  'agent_webhooks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentName: text('agent_name').notNull().unique(),
    webhookPath: text('webhook_path').notNull(),
    method: text('method').notNull().default('POST'),
    authType: text('auth_type').notNull().default('none'), // 'none', 'header', 'basic', 'bearer'
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
    providerTaskIdx: uniqueIndex('video_generation_jobs_provider_task_idx').on(
      table.provider,
      table.taskId
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
    providerTaskIdx: uniqueIndex('edit_jobs_provider_task_idx').on(
      table.provider,
      table.taskId
    ),
  })
);
