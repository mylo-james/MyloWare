import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { createDb } from '../src/db/client';
import { createPool, closePool } from '../src/db/pool';

interface CliOptions {
  dryRun: boolean;
}

interface MigrationResult {
  updated: number;
  pending: number;
  breakdown: Array<{ memoryType: KnownMemoryType; count: number }>;
  dryRun: boolean;
}

const VALID_MEMORY_TYPES = ['persona', 'project', 'semantic', 'episodic', 'procedural'] as const;
type KnownMemoryType = (typeof VALID_MEMORY_TYPES)[number];

function parseArgs(): CliOptions {
  const args = new Set(process.argv.slice(2));
  return {
    dryRun: args.has('--dry-run'),
  };
}

const derivedMemoryTypeExpression = sql.raw(`
  (
    CASE
      WHEN LOWER(metadata ->> 'memoryType') IN ('persona', 'project', 'semantic', 'episodic', 'procedural')
        THEN LOWER(metadata ->> 'memoryType')
      WHEN LOWER(metadata ->> 'type') = 'persona' THEN 'persona'
      WHEN LOWER(metadata ->> 'type') = 'project' THEN 'project'
      WHEN LOWER(metadata ->> 'type') = 'combination' THEN 'semantic'
      WHEN LOWER(metadata ->> 'type') = 'episodic' THEN 'episodic'
      WHEN LOWER(metadata ->> 'type') = 'procedural' THEN 'procedural'
      ELSE 'semantic'
    END
  )::memory_type
`);

async function runMigration(options: CliOptions): Promise<MigrationResult> {
  const pool = createPool();
  const db = createDb(pool);

  try {
    return await db.transaction(async (tx) => {
      const { rows: breakdownRows } = await tx.execute(sql`
        SELECT ${derivedMemoryTypeExpression} AS target_type, COUNT(*)::bigint AS count
        FROM prompt_embeddings
        GROUP BY target_type
        ORDER BY target_type;
      `);

      const breakdown = breakdownRows.map((row) => ({
        memoryType: normalizeMemoryType(row.target_type),
        count: Number(row.count ?? 0),
      }));

      const { rows: pendingRows } = await tx.execute(sql`
        SELECT COUNT(*)::bigint AS count
        FROM (
          SELECT ${derivedMemoryTypeExpression} AS target_type, memory_type
          FROM prompt_embeddings
        ) AS derived
        WHERE derived.memory_type IS DISTINCT FROM derived.target_type;
      `);

      const pending = Number(pendingRows[0]?.count ?? 0);

      if (options.dryRun) {
        return {
          updated: 0,
          pending,
          breakdown,
          dryRun: true,
        };
      }

      const { rows: updateRows } = await tx.execute(sql`
        WITH classified AS (
          SELECT id, ${derivedMemoryTypeExpression} AS target_type
          FROM prompt_embeddings
        )
        UPDATE prompt_embeddings AS pe
        SET memory_type = classified.target_type
        FROM classified
        WHERE pe.id = classified.id
          AND pe.memory_type IS DISTINCT FROM classified.target_type
        RETURNING pe.id;
      `);

      return {
        updated: updateRows.length,
        pending,
        breakdown,
        dryRun: false,
      };
    });
  } finally {
    await closePool();
  }
}

function normalizeMemoryType(value: unknown): KnownMemoryType {
  if (typeof value === 'string') {
    const lower = value.toLowerCase() as KnownMemoryType;
    if (VALID_MEMORY_TYPES.includes(lower)) {
      return lower;
    }
  }
  return 'semantic';
}

function logResult(result: MigrationResult): void {
  console.info('Memory type breakdown:');
  for (const entry of result.breakdown) {
    console.info(`  - ${entry.memoryType}: ${entry.count}`);
  }

  if (result.dryRun) {
    console.info(`Dry run complete. ${result.pending} chunk(s) require memory_type updates.`);
    return;
  }

  console.info(
    `Migration complete. Updated memory_type for ${result.updated} chunk(s); ${result.pending} chunk(s) were already up to date.`,
  );
}

async function main(): Promise<void> {
  const options = parseArgs();

  try {
    const result = await runMigration(options);
    logResult(result);
  } catch (error) {
    console.error('Memory type migration failed:', error);
    process.exitCode = 1;
  }
}

main();
