import type { Config } from 'drizzle-kit';
import dotenv from 'dotenv';

dotenv.config();

const runningInDocker = process.env.DOCKER_CONTAINER === 'true';

function normalizeDatabaseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (!runningInDocker) {
      if (parsed.hostname === 'postgres') {
        parsed.hostname = 'localhost';
      }
      if (process.env.POSTGRES_PORT) {
        parsed.port = process.env.POSTGRES_PORT;
      }
      return parsed.toString();
    }
    return url;
  } catch {
    return url;
  }
}

export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: normalizeDatabaseUrl(process.env.DATABASE_URL!),
  },
} satisfies Config;
