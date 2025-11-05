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

