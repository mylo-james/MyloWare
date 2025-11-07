/**
 * Custom error classes for MCP server
 */

/**
 * JSON-RPC standard error codes (-32700 to -32603)
 * MCP-specific error codes (-32000 to -32099)
 */
export enum MCPErrorCode {
  // JSON-RPC standard codes
  PARSE_ERROR = -32700,
  INVALID_REQUEST = -32600,
  METHOD_NOT_FOUND = -32601,
  INVALID_PARAMS = -32602,
  INTERNAL_ERROR = -32603,
  
  // MCP-specific codes (-32000 to -32099)
  RESOURCE_NOT_FOUND = -32002,
  TRACE_NOT_FOUND = -32004,
  TRACE_OWNERSHIP_CONFLICT = -32005,
  WORKFLOW_NOT_FOUND = -32006,
  PROJECT_NOT_FOUND = -32007,
  PERSONA_NOT_FOUND = -32008,
  MEMORY_NOT_FOUND = -32009,
  VALIDATION_ERROR = -32010,
  DATABASE_ERROR = -32011,
  EXTERNAL_SERVICE_ERROR = -32012,
}

export class MCPError extends Error {
  constructor(
    public code: MCPErrorCode,
    message: string,
    public data?: unknown
  ) {
    super(message);
    this.name = 'MCPError';
    Object.setPrototypeOf(this, MCPError.prototype);
  }
  
  /**
   * Convert to JSON-RPC error format
   */
  toJSONRPC(id: number | string | null = null) {
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: this.code,
        message: this.message,
        ...(this.data ? { data: this.data } : {}),
      },
    };
  }
}

export class DatabaseError extends MCPError {
  constructor(message: string, public cause?: Error) {
    super(MCPErrorCode.DATABASE_ERROR, message, { cause: cause?.message });
    this.name = 'DatabaseError';
    Object.setPrototypeOf(this, DatabaseError.prototype);
  }
}

export class OpenAIError extends MCPError {
  constructor(message: string, public statusCode?: number) {
    super(MCPErrorCode.EXTERNAL_SERVICE_ERROR, message, { service: 'openai', statusCode });
    this.name = 'OpenAIError';
    Object.setPrototypeOf(this, OpenAIError.prototype);
  }
}

export class WorkflowError extends MCPError {
  constructor(message: string, public workflowId?: string) {
    super(MCPErrorCode.WORKFLOW_NOT_FOUND, message, { workflowId });
    this.name = 'WorkflowError';
    Object.setPrototypeOf(this, WorkflowError.prototype);
  }
}

export class ValidationError extends MCPError {
  constructor(message: string, public field?: string) {
    super(MCPErrorCode.VALIDATION_ERROR, message, { field });
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

export class NotFoundError extends MCPError {
  constructor(message: string, public resource?: string, code: MCPErrorCode = MCPErrorCode.RESOURCE_NOT_FOUND) {
    super(code, message, { resource });
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
    super(MCPErrorCode.EXTERNAL_SERVICE_ERROR, message, { service, cause: cause?.message });
    this.name = 'ExternalServiceError';
    Object.setPrototypeOf(this, ExternalServiceError.prototype);
  }
}

