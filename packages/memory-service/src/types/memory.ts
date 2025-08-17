/**
 * Memory Service Types and Interfaces
 */

// Memory Document Types
export interface MemoryDocument {
  id: string;
  type: 'CONTEXT' | 'KNOWLEDGE' | 'TEMPLATE';
  content: string;
  embedding: number[];
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
  tags?: string[] | undefined;
  sourceId?: string | undefined;
  version: number;
}

export interface MemorySearchQuery {
  query: string;
  type?: 'CONTEXT' | 'KNOWLEDGE' | 'TEMPLATE';
  limit?: number;
  threshold?: number;
  tags?: string[];
  metadata?: Record<string, any>;
}

export interface MemorySearchResult {
  document: MemoryDocument;
  similarity: number;
  rank: number;
}

// MCP Protocol Types
export interface MCPRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: any;
}

export interface MCPResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: any;
  error?: MCPError;
}

export interface MCPError {
  code: number;
  message: string;
  data?: any;
}

export interface MCPNotification {
  jsonrpc: '2.0';
  method: string;
  params?: any;
}

// Memory MCP Methods
export interface StoreMemoryParams {
  content: string;
  type: 'CONTEXT' | 'KNOWLEDGE' | 'TEMPLATE';
  metadata?: Record<string, any>;
  tags?: string[];
  sourceId?: string;
}

export interface SearchMemoryParams {
  query: string;
  type?: 'CONTEXT' | 'KNOWLEDGE' | 'TEMPLATE';
  limit?: number;
  threshold?: number;
  tags?: string[];
}

export interface RetrieveMemoryParams {
  id: string;
}

export interface UpdateMemoryParams {
  id: string;
  content?: string;
  metadata?: Record<string, any>;
  tags?: string[];
}

export interface DeleteMemoryParams {
  id: string;
}

// Service Configuration
export interface MemoryServiceConfig {
  port: number;
  host: string;
  databaseUrl: string;
  embeddingDimensions: number;
  defaultSearchLimit: number;
  defaultSimilarityThreshold: number;
  maxContentLength: number;
}

export const DEFAULT_MEMORY_CONFIG: MemoryServiceConfig = {
  port: 3002,
  host: '0.0.0.0',
  databaseUrl: 'postgresql://myloware:myloware_dev_password@localhost:5432/myloware',
  embeddingDimensions: 1536, // OpenAI embedding dimensions
  defaultSearchLimit: 10,
  defaultSimilarityThreshold: 0.7,
  maxContentLength: 10000,
};
