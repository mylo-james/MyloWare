import Fastify, { type RouteHandler } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { config } from './config/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest, DEFAULT_NEGOTIATED_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { registerMCPTools, registerMCPResources, registerMCPPrompts } from './mcp/handlers.js';
import { mcpTools } from './mcp/tools.js';
import { logger } from './utils/logger.js';
import { pool } from './db/client.js';
import { embedText } from './utils/embedding.js';
import { register } from './utils/metrics.js';
import { randomUUID } from 'node:crypto';
import { handleTracePrep } from './api/routes/trace-prep.js';
import { startRetryQueueProcessor, stopRetryQueueProcessor } from './utils/retry-queue.js';
import { authenticateRequest } from './security/authentication.js';
import { TraceRepository } from './db/repositories/index.js';
import { getPersona } from './tools/context/getPersonaTool.js';
import { deriveAllowedTools } from './utils/trace-prep.js';

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

// Be liberal in detecting initialize requests to comply with evolving spec
type InitializeClientInfo = {
  name?: string;
  version?: string;
  [key: string]: unknown;
};

type InitializeParams = {
  clientInfo?: InitializeClientInfo;
  capabilities?: Record<string, unknown>;
  protocolVersion?: string;
  [key: string]: unknown;
};

type MutableInitializeMessage = {
  method?: string;
  params?: InitializeParams;
  [key: string]: unknown;
};

function looksLikeInitializeRequest(payload: unknown): boolean {
  try {
    if (!payload || typeof payload !== 'object') return false;
    // Single JSON-RPC object
    const obj = payload as Record<string, unknown>;
    if (typeof obj.method === 'string' && obj.method.toLowerCase() === 'initialize') {
      return true;
    }
    // Batch request
    if (Array.isArray(payload)) {
      return payload.some((item) => {
        return (
          item &&
          typeof item === 'object' &&
          typeof (item as Record<string, unknown>).method === 'string' &&
          String((item as Record<string, unknown>).method).toLowerCase() === 'initialize'
        );
      });
    }
    // Fallback to SDK type guard if available
    return isInitializeRequest(obj as Parameters<typeof isInitializeRequest>[0]);
  } catch {
    return false;
  }
}

function normalizeInitializeMessages(payload: unknown): unknown {
  const normalize = (message: MutableInitializeMessage) => {
    if (!message || typeof message !== 'object') {
      return;
    }
    if (typeof message.method !== 'string') {
      return;
    }
    if (message.method.toLowerCase() !== 'initialize') {
      return;
    }
    if (!message.params || typeof message.params !== 'object') {
      message.params = {};
    }
    const params = message.params;
    if (!params.clientInfo || typeof params.clientInfo !== 'object') {
      params.clientInfo = {
        name: 'unknown-client',
        version: '0.0.0',
      };
    } else {
      if (typeof params.clientInfo.name !== 'string' || params.clientInfo.name.trim() === '') {
        params.clientInfo.name = 'unknown-client';
      }
      if (typeof params.clientInfo.version !== 'string' || params.clientInfo.version.trim() === '') {
        params.clientInfo.version = '0.0.0';
      }
    }
    if (!params.capabilities || typeof params.capabilities !== 'object') {
      params.capabilities = {};
    }
    if (typeof params.protocolVersion !== 'string' || params.protocolVersion.trim() === '') {
      params.protocolVersion = DEFAULT_NEGOTIATED_PROTOCOL_VERSION;
    }
  };

  if (Array.isArray(payload)) {
    payload.forEach((item) => {
      if (item && typeof item === 'object') {
        normalize(item as MutableInitializeMessage);
      }
    });
    return payload;
  }

  if (payload && typeof payload === 'object') {
    normalize(payload as MutableInitializeMessage);
  }
  return payload;
}

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

  // For GET, support SSE per MCP spec by delegating to transport.handleRequest
  // We do not short-circuit here; GET will be handled below via transport.

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
    } else if (!sessionId && body && looksLikeInitializeRequest(body)) {
      logger.debug({
        msg: 'Initializing new MCP session',
        requestId,
      });
      // New initialization request - create new session
      const port = config.server.port;
      const corsOrigins = config.security.allowedCorsOrigins;
      const baseHosts = config.security.allowedHostKeys;
      const hostsWithPorts = Array.from(
        new Set(baseHosts.flatMap((host) => [host, `${host}:${port}`])),
      );
      const allowedOrigins = corsOrigins.length > 0 ? corsOrigins : undefined;

      transport = new StreamableHTTPServerTransport({
        enableJsonResponse: true,
        sessionIdGenerator: () => randomUUID(),
        enableDnsRebindingProtection: true,
        allowedHosts: hostsWithPorts,
        allowedOrigins,
        onsessioninitialized: (newSessionId) => {
          // Store the transport by session ID
          transports.set(newSessionId, transport);
          transportLastAccess.set(newSessionId, Date.now());
          // Expose session header per MCP spec so client can resume
          try {
            reply.header('Mcp-Session-Id', newSessionId);
          } catch {
            // ignore header failures
          }
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
      logger.warn({
        msg: 'MCP request rejected: missing session and not initialize',
        requestId,
        sessionIdProvided: sessionId,
        hasBody: Boolean(body),
        bodyType: typeof body,
      });
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
    // Delegate to transport; it will parse the JSON-RPC body
    const normalizedPayload = normalizeInitializeMessages(body);
    await transport.handleRequest(request.raw, reply.raw, normalizedPayload);

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

    const normalizedToolName = toolName.trim();

    // Persona gating for sensitive tools
    const sensitiveTools = new Set(['workflow_trigger', 'jobs', 'job_upsert', 'jobs_summary']);
    if (sensitiveTools.has(normalizedToolName)) {
      if (!params || typeof params !== 'object') {
        return reply.code(400).send({
          error: `Body object with traceId is required to call '${normalizedToolName}'`,
        });
      }

      const traceId = typeof (params as Record<string, unknown>).traceId === 'string'
        ? (params as Record<string, unknown>).traceId
        : undefined;

      if (!traceId) {
        return reply.code(400).send({
          error: `Parameter 'traceId' is required to call '${normalizedToolName}'`,
        });
      }

      const traceRepo = new TraceRepository();
      const trace = await traceRepo.findByTraceId(traceId);

      if (!trace) {
        return reply.code(404).send({
          error: `Trace not found: ${traceId}`,
        });
      }

      const personaName = (trace.currentOwner || 'casey').toLowerCase();
      const personaResult = await getPersona({ personaName });

      const allowedTools = deriveAllowedTools({
        personaName,
        personaMeta: personaResult.meta ?? {},
        personaConfig: personaResult.persona,
        projectKnown: Boolean(trace.projectId),
      });

      const canonicalToolName =
        normalizedToolName === 'job_upsert' || normalizedToolName === 'jobs_summary'
          ? 'jobs'
          : normalizedToolName;

      if (!allowedTools.includes(canonicalToolName)) {
        return reply.code(403).send({
          error: `Tool '${normalizedToolName}' is not permitted for persona '${trace.currentOwner}'`,
          allowedTools,
        });
      }
    }

    // Find the tool
    const tool = mcpTools.find(t => t.name === normalizedToolName);
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

    // FAIL-CLOSED CORS: If no origins configured, reject all CORS requests
    const corsOrigins = config.security.allowedCorsOrigins;
    await fastify.register(cors, {
      origin: corsOrigins.length > 0 ? corsOrigins : false,
      credentials: true,
    });

    logger.info({
      msg: 'CORS configuration loaded',
      originsCount: corsOrigins.length,
      failClosed: corsOrigins.length === 0,
    });

    await fastify.register(rateLimit, {
      max: config.security.rateLimitMax,
      timeWindow: config.security.rateLimitTimeWindow,
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
