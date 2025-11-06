import { describe, it, expect } from 'vitest';
import {
  MCPError,
  DatabaseError,
  OpenAIError,
  WorkflowError,
  ValidationError,
} from '@/utils/errors.js';

describe('Error Classes', () => {
  it('should create MCPError with code', () => {
    const error = new MCPError('Test error', 'TEST_CODE');
    expect(error.message).toBe('Test error');
    expect(error.code).toBe('TEST_CODE');
    expect(error.name).toBe('MCPError');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(MCPError);
  });

  it('should create DatabaseError with cause', () => {
    const cause = new Error('Original error');
    const error = new DatabaseError('Database failed', cause);
    expect(error.message).toBe('Database failed');
    expect(error.code).toBe('DATABASE_ERROR');
    expect(error.cause).toBe(cause);
    expect(error).toBeInstanceOf(MCPError);
    expect(error).toBeInstanceOf(DatabaseError);
  });

  it('should create OpenAIError with status code', () => {
    const error = new OpenAIError('API error', 429);
    expect(error.message).toBe('API error');
    expect(error.code).toBe('OPENAI_ERROR');
    expect(error.statusCode).toBe(429);
    expect(error).toBeInstanceOf(MCPError);
    expect(error).toBeInstanceOf(OpenAIError);
  });

  it('should create WorkflowError with workflow ID', () => {
    const error = new WorkflowError('Workflow failed', 'workflow-123');
    expect(error.message).toBe('Workflow failed');
    expect(error.code).toBe('WORKFLOW_ERROR');
    expect(error.workflowId).toBe('workflow-123');
    expect(error).toBeInstanceOf(MCPError);
    expect(error).toBeInstanceOf(WorkflowError);
  });

  it('should create ValidationError with field', () => {
    const error = new ValidationError('Invalid input', 'email');
    expect(error.message).toBe('Invalid input');
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.field).toBe('email');
    expect(error).toBeInstanceOf(MCPError);
    expect(error).toBeInstanceOf(ValidationError);
  });

  it('should serialize errors for logging', () => {
    const error = new DatabaseError('Test', new Error('Cause'));
    const serialized = JSON.stringify({
      name: error.name,
      message: error.message,
      code: error.code,
    });
    expect(serialized).toContain('DatabaseError');
    expect(serialized).toContain('DATABASE_ERROR');
  });
});

