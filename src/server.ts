import Fastify, {
  type FastifyReply,
  type FastifyRequest,
  type RouteHandler,
} from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { config } from './config/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { registerMCPTools, registerMCPResources, registerMCPPrompts } from './mcp/handlers.js';
import { mcpTools } from './mcp/tools.js';
import { logger } from './utils/logger.js';
import { pool } from './db/client.js';
import { embedText } from './utils/embedding.js';
import { register } from './utils/metrics.js';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { handleTracePrep } from './api/routes/trace-prep.js';
import { startRetryQueueProcessor, stopRetryQueueProcessor } from './utils/retry-queue.js';
const hashValue = (value: string) =>
  createHash('sha256').update(value).digest('hex');

const fastify = Fastify({
  logger: {
    level: config.logLevel,
  },
});

// Create MCP server instance with explicit capabilities
const mcpServer = new McpServer({
  name: 'mcp-prompts',
  version: '2.0.0',
}, {
  capabilities: {
    tools: { listChanged: true },
    resources: { subscribe: true, listChanged: true },
    prompts: { listChanged: true }
  }
});

import { SESSION_TTL_MS, MAX_SESSIONS } from './utils/constants.js';

// Session transport management
const transports = new Map<string, StreamableHTTPServerTransport>();
const transportLastAccess = new Map<string, number>(); // Track last access time for TTL cleanup

// Cleanup abandoned sessions
function cleanupSessions() {
  const now = Date.now();
  const sessionsToRemove: string[] = [];

  // Remove sessions that exceed TTL
  for (const [sessionId, lastAccess] of transportLastAccess.entries()) {
    if (now - lastAccess > SESSION_TTL_MS) {
      sessionsToRemove.push(sessionId);
    }
  }

  // If we're over the limit, use LRU eviction (remove oldest sessions)
  if (transports.size > MAX_SESSIONS) {
    const sortedByAccess = Array.from(transportLastAccess.entries())
      .sort((a, b) => a[1] - b[1]); // Sort by last access time (oldest first)
    
    const excessCount = transports.size - MAX_SESSIONS;
    for (let i = 0; i < excessCount; i++) {
      sessionsToRemove.push(sortedByAccess[i][0]);
    }
  }

  // Remove sessions
  for (const sessionId of sessionsToRemove) {
    const transport = transports.get(sessionId);
    const lastAccess = transportLastAccess.get(sessionId);
    if (transport) {
      const reason = lastAccess && (now - lastAccess > SESSION_TTL_MS) ? 'TTL expired' : 'LRU eviction';
      transport.close();
      transports.delete(sessionId);
      transportLastAccess.delete(sessionId);
      logger.debug({
        msg: 'Cleaned up abandoned session',
        sessionId,
        reason,
      });
    }
  }

  if (sessionsToRemove.length > 0) {
    logger.info({
      msg: 'Session cleanup completed',
      removedCount: sessionsToRemove.length,
      remainingCount: transports.size,
    });
  }
}

// Run cleanup every 5 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
let cleanupInterval: NodeJS.Timeout | null = null;

// Initialize MCP server with all handlers (async)
async function initializeMCPServer() {
  registerMCPTools(mcpServer);
  registerMCPResources(mcpServer);
  await registerMCPPrompts(mcpServer); // Now async - loads prompts dynamically from DB
  logger.info({
    msg: 'MCP server initialized',
    tools: mcpTools.length,
  });
}

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

const authenticateRequest = (
  request: FastifyRequest,
  reply: FastifyReply,
  requestId: string,
): request is FastifyRequest => {
  if (!config.mcp.authKey) {
    return true;
  }

  const apiKeyHeader = request.headers['x-api-key'] as string | undefined;
  const providedKey = apiKeyHeader?.trim() || '';

  // Use constant-time comparison to prevent timing attacks
  try {
    const expectedKeyBuffer = Buffer.from(config.mcp.authKey, 'utf8');
    const providedKeyBuffer = Buffer.from(providedKey, 'utf8');
    
    // If lengths differ, use timingSafeEqual with same-length buffers to prevent length-based timing leaks
    if (expectedKeyBuffer.length !== providedKeyBuffer.length) {
      // Compare with a dummy buffer of the same length as expected to maintain constant time
      const dummyBuffer = Buffer.alloc(expectedKeyBuffer.length);
      timingSafeEqual(expectedKeyBuffer, dummyBuffer);
      return false;
    }
    
    if (timingSafeEqual(expectedKeyBuffer, providedKeyBuffer)) {
      return true;
    }
  } catch {
    // If timingSafeEqual fails (shouldn't happen), fall back to false
    return false;
  }

  // In production, log minimal info. In development, log detailed debug info.
  const isProduction = process.env.NODE_ENV === 'production';
  
  if (isProduction) {
    logger.warn({
      msg: 'Unauthorized MCP access attempt',
      requestId,
      ip: request.ip,
      url: request.url,
      method: request.method,
      // Don't log sensitive data in production
    });
  } else {
    // Debug logging for development only
  logger.warn({
    msg: 'Unauthorized MCP access attempt',
    requestId,
    ip: request.ip,
    userAgent: request.headers['user-agent'],
    url: request.url,
    method: request.method,
    headerKeys: Object.keys(request.headers ?? {}),
    providedKeyLength: providedKey?.length ?? 0,
    expectedKeyLength: config.mcp.authKey?.length ?? 0,
      keysMatch: providedKey === config.mcp.authKey,
      // Only log hashes in development, never actual keys
    providedKeyHash: providedKey ? hashValue(providedKey) : null,
    expectedKeyHash: config.mcp.authKey ? hashValue(config.mcp.authKey) : null,
  });
  }

  reply.code(401).send({
    jsonrpc: '2.0',
    error: {
      code: -32001,
      message: 'Unauthorized',
    },
    id: null,
  });
  return false;
};

const handleMcpRequest: RouteHandler = async (request, reply) => {
  const requestId = randomUUID();
  const startTime = Date.now();

  if (!authenticateRequest(request, reply, requestId)) {
    return;
  }

  if (request.method === 'OPTIONS') {
    reply
      .header('allow', 'OPTIONS, GET, POST')
      .header('access-control-allow-methods', 'OPTIONS, GET, POST')
      .header('access-control-allow-headers', 'content-type, x-api-key, accept')
      .code(204)
      .send();
    return;
  }

  if (request.method === 'GET') {
    reply.code(200).send({
      status: 'ready',
      message: 'MCP endpoint available. Use POST for JSON-RPC requests.',
      timestamp: new Date().toISOString(),
    });
    return;
  }

  try {
    logger.info({
      msg: 'MCP request received',
      requestId,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
      hasAuth: !!config.mcp.authKey,
    });

    const body = request.body as unknown;
    const sessionId = request.headers['mcp-session-id'] as string | undefined;
    let transport: StreamableHTTPServerTransport;

    // Check for existing session or create new one
    if (sessionId && transports.has(sessionId)) {
      // Reuse existing transport for this session
      transport = transports.get(sessionId)!;
      // Update last access time
      transportLastAccess.set(sessionId, Date.now());
      logger.debug({
        msg: 'Reusing existing transport',
        requestId,
        sessionId,
      });
    } else if (!sessionId && body && isInitializeRequest(body)) {
      // New initialization request - create new session
      const port = config.server.port;
      // Check if origins include wildcard - if so, disable origin validation
      const hasWildcard = config.security?.allowedOrigins?.includes('*');
      const allowedOrigins = hasWildcard ? undefined : (config.security?.allowedOrigins || []);
      
      transport = new StreamableHTTPServerTransport({
        enableJsonResponse: true,
        sessionIdGenerator: () => randomUUID(),
        enableDnsRebindingProtection: false, // Disable for internal Docker network
        allowedHosts: [
          '127.0.0.1',
          `127.0.0.1:${port}`,
          'localhost',
          `localhost:${port}`,
          'mcp-server',
          `mcp-server:${port}`,
          'mcp-vector.mjames.dev',
          ...(config.security?.allowedOrigins?.filter(origin => origin !== '*') || [])
        ],
        allowedOrigins,
        onsessioninitialized: (newSessionId) => {
          // Store the transport by session ID
          transports.set(newSessionId, transport);
          transportLastAccess.set(newSessionId, Date.now());
          logger.info({
            msg: 'MCP session initialized',
            requestId,
            sessionId: newSessionId,
          });
        }
      });

      // Clean up transport when closed
      transport.onclose = () => {
        if (transport.sessionId) {
          transports.delete(transport.sessionId);
          transportLastAccess.delete(transport.sessionId);
          logger.info({
            msg: 'MCP session closed',
            requestId,
            sessionId: transport.sessionId,
          });
        }
      };

      // Connect server to the new transport
      await mcpServer.connect(transport);
    } else {
      // Invalid request - no session ID and not an initialize request
      reply.code(400).send({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Bad Request: No valid session ID provided',
        },
        id: null,
      });
      return;
    }

    reply.raw.on('close', () => {
      // Don't close transport on request close - keep it for session reuse
      // Only close if session is explicitly terminated
    });

    const requiredAccept = 'application/json, text/event-stream';
    const incomingAccept = request.headers.accept;
    const hasRequiredAccept =
      typeof incomingAccept === 'string' &&
      incomingAccept.includes('application/json') &&
      incomingAccept.includes('text/event-stream');
    if (!hasRequiredAccept) {
      request.headers.accept = requiredAccept;
      (
        request.raw.headers as Record<string, string | string[] | undefined>
      ).accept = requiredAccept;
    }

    // Hijack the reply to prevent Fastify from auto-sending
    reply.hijack();
    await transport.handleRequest(request.raw, reply.raw, body);

    const duration = Date.now() - startTime;
    logger.info({
      msg: 'MCP request completed',
      requestId,
      duration,
      status: 'success',
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    const isProduction = process.env.NODE_ENV === 'production';
    
    // Always log detailed error info for debugging
    logger.error({
      msg: 'MCP request error',
      requestId,
      duration,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    if (!reply.sent) {
      // In production, return generic error. In development, include more detail.
      const errorMessage = isProduction
        ? 'Internal server error'
        : error instanceof Error ? error.message : 'Internal server error';
      
      reply.code(500).send({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: errorMessage,
        },
        id: null,
      });
    }
  }
};

fastify.options('/mcp', handleMcpRequest);
fastify.get('/mcp', handleMcpRequest);
fastify.post('/mcp', handleMcpRequest);

// trace_prep HTTP endpoint (for n8n workflows)
fastify.post('/mcp/trace_prep', async (request, reply) => {
  const requestId = randomUUID();
  if (!authenticateRequest(request, reply, requestId)) {
    return;
  }
  await handleTracePrep(request, reply);
});

// Direct tool call endpoint (bypasses MCP session management for n8n workflows)
fastify.post('/tools/:toolName', async (request, reply) => {
  const requestId = randomUUID();
  const startTime = Date.now();

  if (!authenticateRequest(request, reply, requestId)) {
    return;
  }

  const { toolName } = request.params as { toolName: string };
  const params = request.body as unknown;

  try {
    logger.info({
      msg: 'Direct tool call',
      requestId,
      toolName,
      ip: request.ip,
    });

    // Find the tool
    const tool = mcpTools.find(t => t.name === toolName);
    if (!tool) {
      return reply.code(404).send({
        error: `Tool '${toolName}' not found`,
        availableTools: mcpTools.map(t => t.name),
      });
    }

    // Call the tool handler directly
    const result = await tool.handler(params, requestId);

    const duration = Date.now() - startTime;
    logger.info({
      msg: 'Direct tool call completed',
      requestId,
      toolName,
      duration,
    });

    return reply.code(200).send(result);
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error({
      msg: 'Direct tool call error',
      requestId,
      toolName,
      duration,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    return reply.code(500).send({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

const start = async () => {
  try {
    // Initialize MCP server (load prompts from DB, register tools, etc.)
    await initializeMCPServer();

    // Register security middleware
    // Note: Helmet's strict policies can block MCP responses, so we disable some for /mcp endpoint
    await fastify.register(helmet, {
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'https:'],
        },
      },
      // Disable COEP and CORP which can block cross-origin MCP requests
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: false,
      // Disable COOP for MCP endpoint compatibility
      crossOriginOpenerPolicy: false,
    });

    await fastify.register(cors, {
      origin: config.security?.allowedOrigins || ['http://localhost:5678', 'http://n8n:5678'],
      credentials: true,
    });

    await fastify.register(rateLimit, {
      max: config.security?.rateLimitMax || 100,
      timeWindow: config.security?.rateLimitTimeWindow || '1 minute',
      keyGenerator: (request) => {
        // Use API key for rate limiting if available, otherwise use IP
        return (
          (request.headers['x-api-key'] as string) || request.ip || 'unknown'
        );
      },
    });

    await fastify.listen({
      port: config.server.port,
      host: config.server.host,
    });

    // Start session cleanup interval
    cleanupInterval = setInterval(cleanupSessions, CLEANUP_INTERVAL_MS);
    logger.info({
      msg: 'Session cleanup started',
      intervalMs: CLEANUP_INTERVAL_MS,
      ttlMs: SESSION_TTL_MS,
      maxSessions: MAX_SESSIONS,
    });

    // Start retry queue processor
    startRetryQueueProcessor();

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

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info({ msg: 'SIGTERM received, shutting down gracefully' });
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
  stopRetryQueueProcessor();
  await fastify.close();
  await pool.end();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info({ msg: 'SIGINT received, shutting down gracefully' });
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
  stopRetryQueueProcessor();
  await fastify.close();
  await pool.end();
  process.exit(0);
});

start();
