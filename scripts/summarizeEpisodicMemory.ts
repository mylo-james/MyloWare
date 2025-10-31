#!/usr/bin/env tsx

import process from 'node:process';
import { sql } from 'drizzle-orm';
import { createDb } from '../src/db/client';
import type { ConversationRole } from '../src/db/schema';
import { EpisodicMemoryRepository } from '../src/db/episodicRepository';
import { config } from '../src/config';

interface RawTurn {
  id: string;
  session_id: string;
  user_id: string | null;
  role: ConversationRole;
  turn_index: number;
  content: string;
  created_at: string | null;
}

interface SessionBatch {
  session_id: string;
  turns: RawTurn[];
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const thresholdDays = config.episodicMemory.summaryThresholdDays;
  const batchLimit = config.episodicMemory.summaryBatchLimit;

  const db = createDb();
  const repository = new EpisodicMemoryRepository({ db });

  const { rows } = await db.execute<SessionBatch>(sql`
    WITH candidates AS (
      SELECT
        session_id,
        id,
        user_id,
        role,
        turn_index,
        content,
        created_at
      FROM conversation_turns
      WHERE created_at < NOW() - (${thresholdDays} || ' days')::interval
        AND (metadata->>'ttl_state' IS NULL OR metadata->>'ttl_state' <> 'archived')
    ),
    ranked AS (
      SELECT
        session_id,
        json_agg(
          json_build_object(
            'id', id,
            'session_id', session_id,
            'user_id', user_id,
            'role', role,
            'turn_index', turn_index,
            'content', content,
            'created_at', created_at
          )
          ORDER BY turn_index
        ) AS turns
      FROM candidates
      GROUP BY session_id
    )
    SELECT session_id, turns
    FROM ranked
    ORDER BY session_id
    LIMIT ${batchLimit};
  `);

  if (rows.length === 0) {
    console.info('No episodic conversations require summarization.');
    return;
  }

  console.info(`Found ${rows.length} sessions to summarize (dryRun=${dryRun}).`);

  for (const row of rows) {
    const turns = (row.turns as RawTurn[]) ?? [];
    if (turns.length === 0) {
      continue;
    }

    const summaryText = buildSummaryText(turns);
    const headline = buildHeadline(turns);
    const turnIds = turns.map((turn) => turn.id);
    const chunkIds = turnIds.map((id) => `episodic::${row.session_id}::${id}`);

    if (dryRun) {
      console.info(
        `[dry-run] Would summarize session ${row.session_id} with ${turns.length} turns. Headline: ${headline}`,
      );
      continue;
    }

    await repository.storeConversationTurn({
      sessionId: row.session_id,
      role: 'system',
      content: summaryText,
      summary: {
        headline,
        summarizedTurnIds: turnIds,
        summarizedAt: new Date().toISOString(),
      },
      metadata: {
        ttl_state: 'summary',
        summary_state: 'summary',
        source_turn_ids: turnIds,
      },
    });

    await db.execute(
      sql`
        UPDATE conversation_turns
        SET metadata = metadata || jsonb_build_object(
          'ttl_state', 'archived',
          'archived_at', now()
        )
        WHERE id = ANY(${turnIds})
      `,
    );

    await db.execute(sql`
      DELETE FROM prompt_embeddings
      WHERE chunk_id = ANY(${chunkIds})
    `);

    console.info(
      `Summarized session ${row.session_id}. Archived ${turns.length} turns and created summary entry.`,
    );
  }
}

function buildSummaryText(turns: RawTurn[]): string {
  const snippets = turns.slice(0, 3).concat(turns.slice(-2));
  const lines = snippets.map((turn) => {
    const timestamp = turn.created_at ? ` @ ${turn.created_at}` : '';
    return `[${turn.role}${timestamp}] ${truncate(turn.content, 220)}`;
  });
  return lines.join('\n');
}

function buildHeadline(turns: RawTurn[]): string {
  const lastAssistant = [...turns].reverse().find((turn) => turn.role === 'assistant');
  return lastAssistant
    ? truncate(lastAssistant.content, 120)
    : truncate(turns[turns.length - 1]?.content ?? 'Conversation summary', 120);
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('Episodic summarization failed', error);
    process.exit(1);
  });
