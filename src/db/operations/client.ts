import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import * as schema from './schema';
import { createOperationsPool } from './pool';

let dbInstance: NodePgDatabase<typeof schema> | undefined;

export function createOperationsDb(pool?: Pool): NodePgDatabase<typeof schema> {
  if (!dbInstance) {
    const pgPool = pool ?? createOperationsPool();
    dbInstance = drizzle(pgPool, { schema });
  }

  return dbInstance;
}

export function getOperationsDb(): NodePgDatabase<typeof schema> {
  return dbInstance ?? createOperationsDb();
}
