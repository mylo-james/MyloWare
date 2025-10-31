import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  varchar,
  vector,
  index,
  customType,
  pgEnum,
  integer,
  uniqueIndex,
  doublePrecision,
} from 'drizzle-orm/pg-core';

const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'tsvector';
  },
});

export const memoryTypeEnum = pgEnum('memory_type', [
  'persona',
  'project',
  'semantic',
  'episodic',
  'procedural',
]);

export const conversationRoleEnum = pgEnum('conversation_role', [
  'user',
  'assistant',
  'system',
  'tool',
]);

export const promptEmbeddings = pgTable(
  'prompt_embeddings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    chunkId: text('chunk_id').notNull().unique(),
    filePath: text('file_path').notNull(),
    chunkText: text('chunk_text').notNull(),
    rawMarkdown: text('raw_markdown').notNull(),
    granularity: varchar('granularity', { length: 20 }).notNull(),
    embedding: vector('embedding', { dimensions: 1536 }).notNull(),
    textsearch: tsvector('textsearch').notNull(),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    checksum: text('checksum').notNull(),
    memoryType: memoryTypeEnum('memory_type').notNull().default('semantic'),
    createdAt: timestamp('created_at', { mode: 'string', withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'string', withTimezone: true }).defaultNow(),
  },
  (table) => ({
    filePathIdx: index('idx_embeddings_file_path').on(table.filePath),
    metadataIdx: index('idx_embeddings_metadata').on(table.metadata),
  }),
);

export const conversationTurns = pgTable(
  'conversation_turns',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sessionId: uuid('session_id').notNull(),
    userId: text('user_id'),
    role: conversationRoleEnum('role').notNull(),
    turnIndex: integer('turn_index').notNull(),
    content: text('content').notNull(),
    summary: jsonb('summary'),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { mode: 'string', withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'string', withTimezone: true }).defaultNow(),
  },
  (table) => ({
    sessionTurnUnique: uniqueIndex('conversation_turns_session_turn_unique').on(
      table.sessionId,
      table.turnIndex,
    ),
  }),
);

export const memoryLinks = pgTable(
  'memory_links',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sourceChunkId: text('source_chunk_id').notNull(),
    targetChunkId: text('target_chunk_id').notNull(),
    linkType: text('link_type').notNull(),
    strength: doublePrecision('strength').notNull(),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { mode: 'string', withTimezone: true }).defaultNow(),
  },
  (table) => ({
    sourceIdx: index('idx_memory_links_source').on(table.sourceChunkId),
    targetIdx: index('idx_memory_links_target').on(table.targetChunkId),
    typeIdx: index('idx_memory_links_type').on(table.linkType),
    uniqueLink: uniqueIndex('memory_links_source_target_type_unique').on(
      table.sourceChunkId,
      table.targetChunkId,
      table.linkType,
    ),
  }),
);

export type MemoryType = (typeof memoryTypeEnum.enumValues)[number];
export type PromptEmbedding = typeof promptEmbeddings.$inferSelect;
export type NewPromptEmbedding = typeof promptEmbeddings.$inferInsert;
export type ConversationRole = (typeof conversationRoleEnum.enumValues)[number];
export type ConversationTurn = typeof conversationTurns.$inferSelect;
export type NewConversationTurn = typeof conversationTurns.$inferInsert;
export type MemoryLink = typeof memoryLinks.$inferSelect;
export type NewMemoryLink = typeof memoryLinks.$inferInsert;
