import fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { config } from './config';
import { registerMcpRoutes } from './server/httpTransport';
import { registerApiRoutes } from './server/routes/api';
import { errorHandler } from './server/errorHandler';
import { checkPendingMigrations } from './db/migrations';
import { metricsRegistry, httpRequestDuration, httpRequestTotal } from './server/metrics';
import { PromptEmbeddingsRepository } from './db/repository';
import { OperationsRepository } from './db/operations/repository';
import { runOperationsMigrations } from './db/operations/migrations';

export async function createServer(): Promise<FastifyInstance> {
  const app = fastify({
    logger: {
      level: config.isProduction ? 'info' : 'debug',
    },
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  });

  await app.register(rateLimit, {
    max: config.http.rateLimitMax,
    timeWindow: config.http.rateLimitWindowMs,
    ban: 5,
    cache: 10000,
  });

  const allowedOrigins = new Set(config.http.allowedOrigins);

  await app.register(cors, {
    credentials: true,
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowedOrigins.size === 0 || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      app.log.warn({ origin }, 'CORS origin rejected');
      callback(new Error('Origin not allowed'), false);
    },
  });

  // Request instrumentation
  app.addHook('onRequest', async (request) => {
    (request as any).startTime = Date.now();
  });

  app.addHook('onResponse', async (request, reply) => {
    const duration = (Date.now() - (request as any).startTime) / 1000;
    const route =
      (request as unknown as { routerPath?: string }).routerPath ??
      request.routeOptions?.url ??
      request.url;
    const labels = {
      method: request.method,
      route,
      status_code: String(reply.statusCode),
    };

    httpRequestDuration.labels(labels).observe(duration);
    httpRequestTotal.labels(labels).inc();
  });

  app.setErrorHandler(errorHandler);

  await registerMcpRoutes(app);
  await registerApiRoutes(app);

  app.get('/health', async (request, reply) => {
    const promptRepo = new PromptEmbeddingsRepository();
    const opsRepo = config.operationsDatabaseUrl ? new OperationsRepository() : null;

    const [dbCheck, opsDbCheck] = await Promise.all([
      promptRepo.checkConnection(),
      opsRepo ? opsRepo.checkConnection() : Promise.resolve({ status: 'disabled' as const }),
    ]);

    const healthy =
      dbCheck.status === 'ok' && (opsDbCheck.status === 'ok' || opsDbCheck.status === 'disabled');

    const response = {
      status: healthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      checks: {
        database: dbCheck,
        operationsDatabase: opsDbCheck,
      },
    };

    return reply.status(healthy ? 200 : 503).send(response);
  });

  app.get('/metrics', async (request, reply) => {
    try {
      const metrics = await metricsRegistry.metrics();
      return reply.type('text/plain').send(metrics);
    } catch (error) {
      app.log.error({ err: error }, 'Failed to generate metrics');
      return reply.status(500).send({ error: 'Failed to generate metrics' });
    }
  });

  return app;
}

async function start(): Promise<void> {
  if (config.operationsDatabaseUrl && !config.isTest) {
    try {
      console.log('[startup] Running operations migrations (project videos/runs schema)...');
      await runOperationsMigrations(config.operationsDatabaseUrl);
      console.log('[startup] Operations migrations complete.');
    } catch (error) {
      console.error('Failed to run operations migrations:', error);
      process.exit(1);
    }
  }

  const app = await createServer();

  // Check for pending migrations
  if (!config.isTest) {
    const pending = await checkPendingMigrations();
    if (pending.length > 0) {
      app.log.error({ pending }, 'Pending migrations detected');
      app.log.error('Please run: npm run db:migrate');
      process.exit(1);
    }
  }

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Shutting down');
    try {
      await app.close();
      process.exit(0);
    } catch (error) {
      app.log.error(error, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await app.listen({ port: config.SERVER_PORT, host: config.SERVER_HOST });
    app.log.info(`Server listening on http://${config.SERVER_HOST}:${config.SERVER_PORT}`);
  } catch (error) {
    app.log.error(error, 'Failed to start server');
    process.exit(1);
  }
}

if (require.main === module) {
  void start();
}
