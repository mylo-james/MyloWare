import { getPool } from './pool';

export async function checkDatabaseHealth(): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('select 1');
  } finally {
    client.release();
  }
}
