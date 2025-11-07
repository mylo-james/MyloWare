import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { logger, sanitizeParams } from '../../utils/logger.js';
import { prepareTraceContext, type TracePrepParams } from '../../utils/trace-prep.js';
import { randomUUID } from 'crypto';

// Input schema matching trace_prepare MCP tool
const tracePrepInputSchema = z.object({
  traceId: z.string().uuid('traceId must be a valid UUID').optional(),
  instructions: z.string().max(10000, 'Instructions must be 10000 characters or less').optional(),
  sessionId: z.string().optional(),
  source: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  memoryLimit: z.number().int().positive().optional(),
});

/**
 * HTTP endpoint handler for trace_prep
 * Wraps the trace_prepare MCP tool logic for use by n8n workflows
 */
export async function handleTracePrep(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const requestId = randomUUID();
  const startTime = Date.now();

  try {
    // Handle case where body might be a string (if n8n double-stringifies)
    let bodyToValidate = request.body;
    if (typeof request.body === 'string') {
      try {
        bodyToValidate = JSON.parse(request.body);
      } catch {
        logger.warn({
          msg: 'trace_prep failed to parse string body',
          requestId,
          body: request.body,
        });
        return reply.code(400).send({
          error: 'Invalid request body: expected JSON object',
        });
      }
    }

    // Log raw body for debugging
    logger.debug({
      msg: 'trace_prep received request',
      requestId,
      bodyType: typeof bodyToValidate,
      bodyKeys: bodyToValidate && typeof bodyToValidate === 'object' ? Object.keys(bodyToValidate) : [],
      contentType: request.headers['content-type'],
      ip: request.ip,
    });

    // Validate input - handle null traceId by converting to undefined
    const bodyForValidation =
      bodyToValidate && typeof bodyToValidate === 'object' && !Array.isArray(bodyToValidate)
        ? {
            ...(bodyToValidate as Record<string, unknown>),
            traceId:
              'traceId' in bodyToValidate && bodyToValidate.traceId === null
                ? undefined
                : (bodyToValidate as Record<string, unknown>).traceId,
          }
        : {};

    const validated = tracePrepInputSchema.parse(bodyForValidation);

    logger.info({
      msg: 'trace_prep HTTP endpoint called',
      requestId,
      params: sanitizeParams({ ...validated, instructions: validated.instructions ? '[redacted]' : undefined }),
      ip: request.ip,
    });

    // Prepare trace context using shared utility
    const tracePrepParams: TracePrepParams = {
      traceId: validated.traceId ?? undefined,
      instructions: validated.instructions,
        sessionId: validated.sessionId,
      source: validated.source,
      metadata: validated.metadata,
      memoryLimit: validated.memoryLimit,
    };

    let responsePayload;
    try {
      responsePayload = await prepareTraceContext(tracePrepParams);
    } catch (error) {
      if (error instanceof Error && error.message.includes('Trace not found')) {
        return reply.code(404).send({
          error: error.message,
    });
      }
      throw error;
    }

    const duration = Date.now() - startTime;
    logger.info({
      msg: 'trace_prep HTTP endpoint completed',
      requestId,
      duration,
      traceId: responsePayload.traceId,
      justCreated: responsePayload.justCreated,
    });

    return reply.code(200).send(responsePayload);
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error({
      msg: 'trace_prep HTTP endpoint error',
      requestId,
      duration,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    if (error instanceof z.ZodError) {
      logger.warn({
        msg: 'trace_prep validation error',
        requestId,
        errors: error.errors,
        receivedBody: request.body,
      });
      return reply.code(400).send({
        error: 'Invalid request body',
        details: error.errors,
      });
    }

    return reply.code(500).send({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

