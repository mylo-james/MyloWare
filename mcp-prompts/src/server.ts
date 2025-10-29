import fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { config } from './config';
import { registerMcpRoutes } from './server/httpTransport';

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

  app.setErrorHandler((error, request, reply) => {
    app.log.error({ err: error, url: request.url }, 'Unhandled error');
    const status = error.statusCode ?? 500;
    void reply.status(status).send({ error: 'Internal Server Error' });
  });

  await registerMcpRoutes(app);

  app.get('/health', async () => ({ status: 'ok' }));

  return app;
}

async function start(): Promise<void> {
  const app = await createServer();

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
