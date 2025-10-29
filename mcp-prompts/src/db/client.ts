import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import * as schema from './schema';
import { createPool } from './pool';

let dbInstance: NodePgDatabase<typeof schema> | undefined;

export function createDb(pool?: Pool): NodePgDatabase<typeof schema> {
  if (!dbInstance) {
    const pgPool = pool ?? createPool();
    dbInstance = drizzle(pgPool, { schema });
  }

  return dbInstance;
}

export function getDb(): NodePgDatabase<typeof schema> {
  return dbInstance ?? createDb();
}
