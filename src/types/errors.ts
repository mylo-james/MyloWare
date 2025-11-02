export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
    timestamp: string;
    path: string;
    requestId?: string;
  };
}

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class ValidationError extends ApiError {
  constructor(message: string, details?: unknown) {
    super(400, 'VALIDATION_ERROR', message, details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends ApiError {
  constructor(message: string) {
    super(404, 'NOT_FOUND', message);
    this.name = 'NotFoundError';
  }
}

export class DatabaseError extends ApiError {
  constructor(
    message: string,
    public cause?: Error,
  ) {
    super(503, 'DATABASE_ERROR', message);
    this.name = 'DatabaseError';
  }
}

export class WorkflowError extends ApiError {
  constructor(
    message: string,
    public workflowId: string,
    public stage: string,
  ) {
    super(500, 'WORKFLOW_ERROR', message, { workflowId, stage });
    this.name = 'WorkflowError';
  }
}

