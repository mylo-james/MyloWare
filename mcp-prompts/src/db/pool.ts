import { Pool, PoolConfig } from 'pg';

let poolInstance: Pool | undefined;

export function createPool(config?: PoolConfig): Pool {
  if (poolInstance) {
    return poolInstance;
  }

  const connectionString = process.env.DATABASE_URL;

  if (!config && !connectionString) {
    throw new Error('DATABASE_URL is not set and no Pool configuration was provided.');
  }

  poolInstance = new Pool(config ?? { connectionString });

  poolInstance.on('error', (error) => {
    console.error('Unexpected PostgreSQL client error', error);
  });

  return poolInstance;
}

export function getPool(): Pool {
  return poolInstance ?? createPool();
}

export async function closePool(): Promise<void> {
  if (poolInstance) {
    await poolInstance.end();
    poolInstance = undefined;
  }
}
