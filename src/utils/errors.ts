/**
 * Custom error classes for MCP server
 */

export class MCPError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'MCPError';
    Object.setPrototypeOf(this, MCPError.prototype);
  }
}

export class DatabaseError extends MCPError {
  constructor(message: string, public cause?: Error) {
    super(message, 'DATABASE_ERROR');
    this.name = 'DatabaseError';
    Object.setPrototypeOf(this, DatabaseError.prototype);
  }
}

export class OpenAIError extends MCPError {
  constructor(message: string, public statusCode?: number) {
    super(message, 'OPENAI_ERROR');
    this.name = 'OpenAIError';
    Object.setPrototypeOf(this, OpenAIError.prototype);
  }
}

export class WorkflowError extends MCPError {
  constructor(message: string, public workflowId?: string) {
    super(message, 'WORKFLOW_ERROR');
    this.name = 'WorkflowError';
    Object.setPrototypeOf(this, WorkflowError.prototype);
  }
}

export class ValidationError extends MCPError {
  constructor(message: string, public field?: string) {
    super(message, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

export class NotFoundError extends MCPError {
  constructor(message: string, public resource?: string) {
    super(message, 'NOT_FOUND');
    this.name = 'NotFoundError';
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

export class WorkflowTimeoutError extends WorkflowError {
  constructor(
    message: string,
    public workflowId?: string,
    public executionId?: string,
    public timeout?: number
  ) {
    super(message, workflowId);
    this.name = 'WorkflowTimeoutError';
    Object.setPrototypeOf(this, WorkflowTimeoutError.prototype);
  }
}

export class WorkflowExecutionError extends WorkflowError {
  constructor(
    message: string,
    public workflowId?: string,
    public cause?: Error
  ) {
    super(message, workflowId);
    this.name = 'WorkflowExecutionError';
    Object.setPrototypeOf(this, WorkflowExecutionError.prototype);
  }
}

export class ExternalServiceError extends MCPError {
  constructor(message: string, public service: string, public cause?: Error) {
    super(message, 'EXTERNAL_SERVICE_ERROR');
    this.name = 'ExternalServiceError';
    Object.setPrototypeOf(this, ExternalServiceError.prototype);
  }
}

