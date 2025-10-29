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

export type Run = typeof runs.$inferSelect;
export type NewRun = typeof runs.$inferInsert;
export type Video = typeof videos.$inferSelect;
export type NewVideo = typeof videos.$inferInsert;
export type RunStatus = (typeof runStatusEnum.enumValues)[number];
export type VideoStatus = (typeof videoStatusEnum.enumValues)[number];
