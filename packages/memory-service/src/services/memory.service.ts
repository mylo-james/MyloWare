/**
 * Memory Service
 *
 * Core memory management service implementing MCP protocol for knowledge storage and retrieval.
 */

import { Injectable } from '@nestjs/common';
import { createLogger } from '@myloware/shared';
import type {
  MemoryDocument,
  MemorySearchQuery,
  MemorySearchResult,
  StoreMemoryParams,
  SearchMemoryParams,
  RetrieveMemoryParams,
  UpdateMemoryParams,
  DeleteMemoryParams,
  DEFAULT_MEMORY_CONFIG,
} from '../types/memory';

const logger = createLogger('memory-service');

@Injectable()
export class MemoryService {
  private memoryStore: Map<string, MemoryDocument> = new Map();

  constructor() {
    logger.info('Memory service initialized');
  }

  /**
   * Store a memory document
   */
  async storeMemory(
    params: StoreMemoryParams
  ): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const id = `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Simulate embedding generation (would call OpenAI/other embedding service)
      const embedding = Array.from({ length: 1536 }, () => Math.random() - 0.5);

      const document: MemoryDocument = {
        id,
        type: params.type,
        content: params.content,
        embedding,
        metadata: params.metadata || {},
        createdAt: new Date(),
        updatedAt: new Date(),
        tags: params.tags,
        sourceId: params.sourceId,
        version: 1,
      };

      this.memoryStore.set(id, document);

      logger.info('Memory document stored', {
        id,
        type: params.type,
        contentLength: params.content.length,
        tags: params.tags,
      });

      return { success: true, id };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to store memory', { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Search memory documents by similarity
   */
  async searchMemory(
    params: SearchMemoryParams
  ): Promise<{ success: boolean; results?: MemorySearchResult[]; error?: string }> {
    try {
      // Simulate query embedding generation
      const queryEmbedding = Array.from({ length: 1536 }, () => Math.random() - 0.5);

      const documents = Array.from(this.memoryStore.values())
        .filter(doc => !params.type || doc.type === params.type)
        .filter(doc => !params.tags || params.tags.every(tag => doc.tags?.includes(tag)));

      // Calculate similarity scores (cosine similarity simulation)
      const results: MemorySearchResult[] = documents
        .map(document => ({
          document,
          similarity: Math.random() * 0.3 + 0.7, // Simulate 0.7-1.0 similarity
          rank: 0,
        }))
        .filter(result => result.similarity >= (params.threshold || 0.7))
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, params.limit || 10)
        .map((result, index) => ({ ...result, rank: index + 1 }));

      logger.info('Memory search completed', {
        query: params.query,
        type: params.type,
        resultCount: results.length,
        threshold: params.threshold,
      });

      return { success: true, results };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to search memory', { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Retrieve a specific memory document
   */
  async retrieveMemory(
    params: RetrieveMemoryParams
  ): Promise<{ success: boolean; document?: MemoryDocument; error?: string }> {
    try {
      const document = this.memoryStore.get(params.id);

      if (!document) {
        return { success: false, error: `Memory document not found: ${params.id}` };
      }

      logger.info('Memory document retrieved', { id: params.id, type: document.type });
      return { success: true, document };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to retrieve memory', { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Update a memory document
   */
  async updateMemory(params: UpdateMemoryParams): Promise<{ success: boolean; error?: string }> {
    try {
      const document = this.memoryStore.get(params.id);

      if (!document) {
        return { success: false, error: `Memory document not found: ${params.id}` };
      }

      // Update fields
      if (params.content) {
        document.content = params.content;
        // Re-generate embedding for new content
        document.embedding = Array.from({ length: 1536 }, () => Math.random() - 0.5);
      }

      if (params.metadata) {
        document.metadata = { ...document.metadata, ...params.metadata };
      }

      if (params.tags) {
        document.tags = params.tags;
      }

      document.updatedAt = new Date();
      document.version++;

      this.memoryStore.set(params.id, document);

      logger.info('Memory document updated', {
        id: params.id,
        version: document.version,
        hasNewContent: !!params.content,
      });

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to update memory', { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Delete a memory document
   */
  async deleteMemory(params: DeleteMemoryParams): Promise<{ success: boolean; error?: string }> {
    try {
      const existed = this.memoryStore.has(params.id);

      if (!existed) {
        return { success: false, error: `Memory document not found: ${params.id}` };
      }

      this.memoryStore.delete(params.id);

      logger.info('Memory document deleted', { id: params.id });
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to delete memory', { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Get memory service statistics
   */
  getStats(): {
    totalDocuments: number;
    byType: Record<string, number>;
    memoryUsage: NodeJS.MemoryUsage;
  } {
    const documents = Array.from(this.memoryStore.values());
    const byType = documents.reduce(
      (acc, doc) => {
        acc[doc.type] = (acc[doc.type] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    return {
      totalDocuments: documents.length,
      byType,
      memoryUsage: process.memoryUsage(),
    };
  }

  /**
   * Get service health status
   */
  getHealthStatus(): { isHealthy: boolean; documentCount: number; memoryUsage: number } {
    const memUsage = process.memoryUsage();

    return {
      isHealthy: true,
      documentCount: this.memoryStore.size,
      memoryUsage: memUsage.heapUsed,
    };
  }
}
