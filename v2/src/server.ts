import Fastify from 'fastify';
import { config } from './config/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerMCPTools } from './mcp/handlers.js';
import { mcpTools } from './mcp/tools.js';
import { logger } from './utils/logger.js';
import { pool } from './db/client.js';
import { embedText } from './utils/embedding.js';
import { register } from './utils/metrics.js';

const fastify = Fastify({
  logger: {
    level: config.logLevel,
  },
});

// Create MCP server instance
const mcpServer = new McpServer({
  name: 'mcp-prompts-v2',
  version: '2.0.0',
});

// Register all tools
registerMCPTools(mcpServer);

// OpenAI health cache
let openaiHealthCache: { status: string; lastCheck: number } = {
  status: 'unknown',
  lastCheck: 0,
};

// Check OpenAI health every 60 seconds max
const HEALTH_CACHE_TTL = 60000;

// Health endpoint with detailed checks
fastify.get('/health', async () => {
  const checks: Record<string, string> = {};
  let allHealthy = true;

  // Check database
  try {
    await pool.query('SELECT 1');
    checks.database = 'ok';
  } catch {
    checks.database = 'error';
    allHealthy = false;
  }

  // Check OpenAI with caching
  const now = Date.now();
  if (now - openaiHealthCache.lastCheck > HEALTH_CACHE_TTL) {
    try {
      await embedText('test');
      openaiHealthCache = { status: 'ok', lastCheck: now };
    } catch {
      openaiHealthCache = { status: 'error', lastCheck: now };
    }
  }
  
  checks.openai = openaiHealthCache.status;
  if (openaiHealthCache.status !== 'ok') {
    allHealthy = false;
  }

  // Check tools
  const toolChecks: Record<string, string> = {};
  for (const tool of mcpTools) {
    toolChecks[tool.name] = 'ok'; // Tools are registered, assume ok
  }
  checks.tools = JSON.stringify(toolChecks);

  return {
    status: allHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    service: 'mcp-server',
    checks,
  };
});

// Prometheus metrics endpoint
fastify.get('/metrics', async (request, reply) => {
  reply.type('text/plain');
  return register.metrics();
});

// MCP endpoint
fastify.post('/mcp', async (request, reply) => {
  try {
    // Check auth if MCP_AUTH_KEY is configured
    if (config.mcp.authKey) {
      const authHeader = request.headers['x-mcp-auth-key'] as string | undefined;
      if (authHeader !== config.mcp.authKey) {
        reply.code(401).send({
          jsonrpc: '2.0',
          error: {
            code: -32001,
            message: 'Unauthorized',
          },
          id: null,
        });
        return;
      }
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    reply.raw.on('close', () => {
      transport.close();
    });

    await mcpServer.connect(transport);
    
    // Convert Fastify request to Node.js readable stream for MCP
    const body = request.body as any;
    await transport.handleRequest(request.raw, reply.raw, body);
  } catch (error) {
    logger.error({
      msg: 'MCP request error',
      error: error instanceof Error ? error.message : String(error),
    });

    if (!reply.sent) {
      reply.code(500).send({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error',
        },
        id: null,
      });
    }
  }
});

const start = async () => {
  try {
    await fastify.listen({
      port: config.server.port,
      host: config.server.host,
    });

    logger.info({
      msg: 'MCP server started',
      port: config.server.port,
      host: config.server.host,
      tools: mcpTools.length,
    });
  } catch (err) {
    logger.error({
      msg: 'Failed to start server',
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  }
};

start();

