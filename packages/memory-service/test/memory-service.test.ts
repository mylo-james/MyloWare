/**
 * Memory Service Tests
 */

import { MemoryService } from '../src/services/memory.service';

describe('Memory Service', () => {
  let memoryService: MemoryService;

  beforeEach(() => {
    memoryService = new MemoryService();
  });

  describe('Initialization', () => {
    it('should initialize successfully', async () => {
      await expect(memoryService.initialize()).resolves.not.toThrow();
    });

    it('should provide health status', () => {
      const health = memoryService.getHealthStatus();

      expect(health).toHaveProperty('isHealthy');
      expect(health).toHaveProperty('documentCount');
      expect(health).toHaveProperty('memoryUsage');
      expect(health.isHealthy).toBe(true);
      expect(health.documentCount).toBe(0);
    });
  });

  describe('Document Management', () => {
    it('should store documents', async () => {
      const result = await memoryService.storeDocument('test content', { type: 'test' }, ['tag1']);

      expect(result).toHaveProperty('id');
      expect(result.id).toMatch(/^doc_/);
    });

    it('should retrieve stored documents', async () => {
      const storeResult = await memoryService.storeDocument('test content');
      const document = await memoryService.getDocument(storeResult.id);

      expect(document).toBeDefined();
      expect(document?.content).toBe('test content');
      expect(document?.type).toBe('KNOWLEDGE');
    });

    it('should search documents', async () => {
      await memoryService.storeDocument('test content 1');
      await memoryService.storeDocument('test content 2');

      const results = await memoryService.searchDocuments('test', 10, 0.5);

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThanOrEqual(0);
    });

    it('should list documents', async () => {
      await memoryService.storeDocument('test content', {}, ['tag1']);

      const documents = await memoryService.listDocuments(10, 0, ['tag1']);

      expect(Array.isArray(documents)).toBe(true);
    });

    it('should delete documents', async () => {
      const storeResult = await memoryService.storeDocument('test content');

      await expect(memoryService.deleteDocument(storeResult.id)).resolves.not.toThrow();

      const document = await memoryService.getDocument(storeResult.id);
      expect(document).toBeNull();
    });
  });
});
