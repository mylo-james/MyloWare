import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, timestamp, jsonb, varchar, vector, index } from 'drizzle-orm/pg-core';

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
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    checksum: text('checksum').notNull(),
    createdAt: timestamp('created_at', { mode: 'string', withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'string', withTimezone: true }).defaultNow(),
  },
  (table) => ({
    filePathIdx: index('idx_embeddings_file_path').on(table.filePath),
    metadataIdx: index('idx_embeddings_metadata').on(table.metadata),
  }),
);

export type PromptEmbedding = typeof promptEmbeddings.$inferSelect;
export type NewPromptEmbedding = typeof promptEmbeddings.$inferInsert;
