import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  index,
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
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Projects table
export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  description: text('description').notNull(),
  workflows: text('workflows').array().notNull(),
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

// Workflow registry table - maps memory IDs to n8n workflow IDs
export const workflowRegistry = pgTable(
  'workflow_registry',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memoryId: uuid('memory_id')
      .notNull()
      .references(() => memories.id, { onDelete: 'cascade' }),
    n8nWorkflowId: text('n8n_workflow_id').notNull(),
    name: text('name').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    memoryIdIdx: index('workflow_registry_memory_id_idx').on(table.memoryId),
    n8nWorkflowIdIdx: index('workflow_registry_n8n_workflow_id_idx').on(
      table.n8nWorkflowId
    ),
    activeIdx: index('workflow_registry_active_idx').on(table.isActive),
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
