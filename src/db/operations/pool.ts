import { Pool, PoolConfig } from 'pg';

let poolInstance: Pool | undefined;

export function createOperationsPool(config?: PoolConfig): Pool {
  if (poolInstance) {
    return poolInstance;
  }

  const connectionString = process.env.OPERATIONS_DATABASE_URL;

  if (!config && !connectionString) {
    throw new Error('OPERATIONS_DATABASE_URL is not set and no Pool configuration was provided.');
  }

  poolInstance = new Pool(config ?? { connectionString });

  poolInstance.on('error', (error) => {
    console.error('Unexpected operations PostgreSQL client error', error);
  });

  return poolInstance;
}

export function getOperationsPool(): Pool {
  return poolInstance ?? createOperationsPool();
}

export async function closeOperationsPool(): Promise<void> {
  if (poolInstance) {
    await poolInstance.end();
    poolInstance = undefined;
  }
}
