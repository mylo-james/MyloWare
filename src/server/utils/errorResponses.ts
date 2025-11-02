import type { FastifyReply } from 'fastify';
import { z } from 'zod';

export function sendValidationError(reply: FastifyReply, error: z.ZodError): void {
  void reply.status(400).send({
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      details: error.errors,
    },
  });
}

export function sendError(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): void {
  void reply.status(statusCode).send({
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
  });
}

