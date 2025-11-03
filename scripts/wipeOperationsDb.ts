import 'dotenv/config';
import { Pool } from 'pg';

const TABLES_IN_DROP_ORDER = ['workflow_runs', 'videos', 'runs'] as const;
const ENUM_TYPES = ['workflow_stage', 'workflow_run_status', 'video_status', 'run_status'] as const;

async function main(): Promise<void> {
  const connectionString = process.env.OPERATIONS_DATABASE_URL;

  if (!connectionString || connectionString.trim().length === 0) {
    throw new Error('OPERATIONS_DATABASE_URL is not configured.');
  }

  const pool = new Pool({ connectionString });
  console.log('⚠️  Wiping operations database schema at', connectionString.replace(/:[^:@/]+@/, '://***:***@'));

  try {
    await pool.query('BEGIN');

    for (const table of TABLES_IN_DROP_ORDER) {
      console.log(`Dropping table ${table}...`);
      await pool.query(`DROP TABLE IF EXISTS ${table} CASCADE;`);
    }

    for (const enumType of ENUM_TYPES) {
      console.log(`Dropping enum type ${enumType} (if present)...`);
      await pool.query(`
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_type WHERE typname = '${enumType}') THEN
            DROP TYPE ${enumType} CASCADE;
          END IF;
        END $$;
      `);
    }

    await pool.query('COMMIT');
    console.log('✅ Operations database wiped successfully.');
  } catch (error) {
    await pool.query('ROLLBACK').catch(() => undefined);
    console.error('❌ Failed to wipe operations database:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('❌ wipeOperationsDb script failed:', error);
  process.exitCode = 1;
});
