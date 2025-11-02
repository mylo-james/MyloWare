import { sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const runStatusEnum = pgEnum('run_status', [
  'pending',
  'idea_gen_pending',
  'idea_gen_complete',
  'ideas',
  'scripts',
  'videos',
  'complete',
  'failed',
]);

export const videoStatusEnum = pgEnum('video_status', [
  'idea_gen',
  'script_gen',
  'video_gen',
  'upload',
  'complete',
  'failed',
]);

export const workflowRunStatusEnum = pgEnum('workflow_run_status', [
  'running',
  'waiting_for_hitl',
  'completed',
  'failed',
  'needs_revision',
]);

export const workflowStageEnum = pgEnum('workflow_stage', [
  'idea_generation',
  'screenplay',
  'video_generation',
  'publishing',
]);

export const hitlApprovalStatusEnum = pgEnum('hitl_approval_status', [
  'pending',
  'approved',
  'rejected',
]);

export const runs = pgTable(
  'runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id').notNull(),
    personaId: uuid('persona_id'),
    chatId: text('chat_id'),
    status: runStatusEnum('status').notNull().default('pending'),
    result: text('result'),
    input: jsonb('input').default(sql`'{}'::jsonb`),
    metadata: jsonb('metadata').default(sql`'{}'::jsonb`),
    startedAt: timestamp('started_at', { mode: 'string', withTimezone: true }),
    completedAt: timestamp('completed_at', { mode: 'string', withTimezone: true }),
    createdAt: timestamp('created_at', { mode: 'string', withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'string', withTimezone: true }).defaultNow(),
  },
  (table) => ({
    projectIdx: index('idx_runs_project').on(table.projectId),
    statusIdx: index('idx_runs_status').on(table.status),
    createdIdx: index('idx_runs_created').on(table.createdAt),
  }),
);

export const videos = pgTable(
  'videos',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').notNull(),
    idea: text('idea').notNull(),
    userIdea: text('user_idea'),
    vibe: text('vibe'),
    prompt: text('prompt'),
    videoLink: text('video_link'),
    status: videoStatusEnum('status').notNull().default('idea_gen'),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at', { mode: 'string', withTimezone: true }),
    completedAt: timestamp('completed_at', { mode: 'string', withTimezone: true }),
    createdAt: timestamp('created_at', { mode: 'string', withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'string', withTimezone: true }).defaultNow(),
    metadata: jsonb('metadata').default(sql`'{}'::jsonb`),
  },
  (table) => ({
    projectIdeaUniqueIdx: uniqueIndex('idx_videos_project_idea').on(table.projectId, table.idea),
    statusIdx: index('idx_videos_status').on(table.status),
    runIdx: index('idx_videos_run').on(table.runId),
    createdIdx: index('idx_videos_created').on(table.createdAt),
    projectIdx: index('idx_videos_project').on(table.projectId),
  }),
);

export const workflowRuns = pgTable(
  'workflow_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: text('project_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    currentStage: workflowStageEnum('current_stage').notNull(),
    status: workflowRunStatusEnum('status').notNull().default('running'),
    stages: jsonb('stages')
      .notNull()
      .default(
        sql`'{"idea_generation":{"status":"pending"},"screenplay":{"status":"pending"},"video_generation":{"status":"pending"},"publishing":{"status":"pending"}}'::jsonb`,
      ),
    input: jsonb('input').notNull().default(sql`'{}'::jsonb`),
    output: jsonb('output'),
    workflowDefinitionChunkId: text('workflow_definition_chunk_id'),
    createdAt: timestamp('created_at', { mode: 'string', withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'string', withTimezone: true }).defaultNow(),
  },
  (table) => ({
    statusIdx: index('idx_workflow_runs_status').on(table.status),
    currentStageIdx: index('idx_workflow_runs_current_stage').on(table.currentStage),
    projectIdx: index('idx_workflow_runs_project').on(table.projectId),
    sessionIdx: index('idx_workflow_runs_session').on(table.sessionId),
    createdIdx: index('idx_workflow_runs_created').on(table.createdAt),
  }),
);

export const hitlApprovals = pgTable(
  'hitl_approvals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workflowRunId: uuid('workflow_run_id')
      .notNull()
      .references(() => workflowRuns.id, { onDelete: 'cascade' }),
    stage: workflowStageEnum('stage').notNull(),
    content: jsonb('content').notNull(),
    status: hitlApprovalStatusEnum('status').notNull().default('pending'),
    reviewedBy: text('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { mode: 'string', withTimezone: true }),
    feedback: text('feedback'),
    createdAt: timestamp('created_at', { mode: 'string', withTimezone: true }).defaultNow(),
  },
  (table) => ({
    statusIdx: index('idx_hitl_approvals_status').on(table.status),
    workflowRunIdx: index('idx_hitl_approvals_workflow_run').on(table.workflowRunId),
    stageIdx: index('idx_hitl_approvals_stage').on(table.stage),
    createdIdx: index('idx_hitl_approvals_created').on(table.createdAt),
  }),
);

export type Run = typeof runs.$inferSelect;
export type NewRun = typeof runs.$inferInsert;
export type Video = typeof videos.$inferSelect;
export type NewVideo = typeof videos.$inferInsert;
export type RunStatus = (typeof runStatusEnum.enumValues)[number];
export type VideoStatus = (typeof videoStatusEnum.enumValues)[number];
export type WorkflowRun = typeof workflowRuns.$inferSelect;
export type NewWorkflowRun = typeof workflowRuns.$inferInsert;
export type HITLApproval = typeof hitlApprovals.$inferSelect;
export type NewHITLApproval = typeof hitlApprovals.$inferInsert;
export type WorkflowRunStatus = (typeof workflowRunStatusEnum.enumValues)[number];
export type WorkflowStage = (typeof workflowStageEnum.enumValues)[number];
export type HITLApprovalStatus = (typeof hitlApprovalStatusEnum.enumValues)[number];
