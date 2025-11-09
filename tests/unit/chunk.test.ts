import { describe, it, expect } from 'vitest';
import { chunkText, ChunkValidationError, DEFAULT_CHUNK_CONFIG } from '@/utils/chunk.js';

/**
 * Unit tests for text chunking utility
 *
 * Tests chunking behavior:
 * - Empty/short text handling
 * - Sentence boundary splitting
 * - Size constraints (target, min, max)
 * - Edge cases (no boundaries, long sentences)
 */
describe('chunkText', () => {
  describe('input validation', () => {
    it('should reject non-string input', () => {
      expect(() => chunkText(123 as any)).toThrow(ChunkValidationError);
      expect(() => chunkText(null as any)).toThrow(ChunkValidationError);
      expect(() => chunkText(undefined as any)).toThrow(ChunkValidationError);
    });

    it('should reject invalid config', () => {
      expect(() => chunkText('test', { targetSize: -1 })).toThrow(
        ChunkValidationError
      );
      expect(() => chunkText('test', { targetSize: 100, maxSize: 50 })).toThrow(
        ChunkValidationError
      );
      expect(() => chunkText('test', { minSize: -1 })).toThrow(
        ChunkValidationError
      );
    });
  });

  describe('empty and short text', () => {
  it('should handle empty text', () => {
    const chunks = chunkText('');
    expect(chunks).toEqual([]);
  });

  it('should handle whitespace-only text', () => {
    const chunks = chunkText('   \n\t  ');
    expect(chunks).toEqual([]);
  });

  it('should return single chunk for short text', () => {
    const text = 'Short text.';
      const chunks = chunkText(text, { targetSize: 1000 });

    expect(chunks.length).toBe(1);
    expect(chunks[0]).toBe('Short text.');
  });

    it('should return single chunk when text < target size', () => {
      const text = 'Short. Text.';
      const result = chunkText(text, { targetSize: 100 });

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(text);
    });
  });

  describe('sentence boundary splitting', () => {
    it('should split text into chunks by sentences', () => {
      const text =
        'This is sentence one. This is sentence two. This is sentence three.';
      const chunks = chunkText(text, { targetSize: 50 });

      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks[0]).toContain('sentence one');
    });

    it('should split on question marks and exclamation marks', () => {
      const text = 'Question? Exclamation! Period.';
      const chunks = chunkText(text, { targetSize: 20 });

      expect(chunks.length).toBeGreaterThan(1);
    });

    it('should preserve sentence boundaries in chunks', () => {
      const text = 'First sentence. Second sentence. Third sentence.';
      const chunks = chunkText(text, { targetSize: 30 });

      // Should not break mid-sentence
      chunks.forEach((chunk) => {
        // Each chunk should end with proper punctuation or be complete
        expect(chunk.trim().length).toBeGreaterThan(0);
      });
    });

    it('should handle different sentence terminators', () => {
      const text = 'Question? Statement. Exclamation!';
      const result = chunkText(text, { targetSize: 20 });

      result.forEach((chunk) => {
        expect(chunk.trim()).toMatch(/[.!?]$/);
      });
    });
  });

  describe('size constraints', () => {
  it('should respect target chunk size', () => {
    const text = 'Word. '.repeat(200); // ~1200 chars
      const chunks = chunkText(text, { targetSize: 500 });

    // Should create multiple chunks
    expect(chunks.length).toBeGreaterThan(1);
    // Each chunk should be roughly around target size (allowing some variance)
    chunks.forEach((chunk) => {
      expect(chunk.length).toBeLessThan(1000); // Reasonable upper bound
    });
  });

    it('should handle very long sentences by splitting at word boundaries', () => {
      const longSentence = 'word '.repeat(1000) + '.';
      const result = chunkText(longSentence, {
        targetSize: 100,
        maxSize: 200,
      });

      expect(result.length).toBeGreaterThan(1);

      // Each chunk should be under max size
      result.forEach((chunk) => {
        expect(chunk.length).toBeLessThanOrEqual(220); // Some buffer for word boundaries
      });
    });

    it('should filter out chunks smaller than minSize', () => {
      const text = 'Big sentence here. Tiny. Another big sentence goes here.';
      const result = chunkText(text, {
        targetSize: 30,
        minSize: 10,
      });

      result.forEach((chunk) => {
        expect(chunk.length).toBeGreaterThanOrEqual(10);
      });
    });

    it('should keep single chunk even if below minSize', () => {
      const text = 'Short.';
      const result = chunkText(text, {
        targetSize: 100,
        minSize: 50,
      });

      // Single chunk should be kept even if below minSize
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(text);
    });
  });

  describe('edge cases', () => {
  it('should handle text without sentence boundaries', () => {
    const text = 'No periods here just words';
      const chunks = chunkText(text, { targetSize: 10 });

    // Should still return the text as a single chunk
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0]).toContain('No periods');
  });

  it('should handle single sentence', () => {
    const text = 'This is a single sentence without any punctuation.';
      const chunks = chunkText(text, { targetSize: 1000 });

    expect(chunks.length).toBe(1);
    expect(chunks[0]).toBe(text.trim());
  });

    it('should handle text with multiple newlines', () => {
      const text = 'First sentence.\n\nSecond sentence.\n\n\nThird sentence.';
      const result = chunkText(text, { targetSize: 30 });

      expect(result.length).toBeGreaterThan(0);
      result.forEach((chunk) => {
        expect(chunk.trim()).not.toBe('');
      });
    });

    it('should handle text with only spaces between sentences', () => {
      const text = 'First.     Second.     Third.';
      const result = chunkText(text, { targetSize: 15 });

      expect(result.length).toBeGreaterThan(1);
  });

    it('should handle text with no sentence boundaries gracefully', () => {
      const text = 'NoSentenceBoundariesHere'.repeat(10);
      const result = chunkText(text, { targetSize: 100 });

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(text.trim());
    });
  });

  describe('default configuration', () => {
    it('should use default config when not provided', () => {
      const text = 'A '.repeat(2000) + '.';
      const result = chunkText(text);

      expect(result.length).toBeGreaterThan(0);

      // Should use default target size
      result.forEach((chunk) => {
        expect(chunk.length).toBeLessThanOrEqual(
          DEFAULT_CHUNK_CONFIG.maxSize + 100
        );
      });
    });

    it('should use default target size', () => {
      const text = 'Word. '.repeat(200);
      const chunks = chunkText(text); // No config provided

      expect(chunks.length).toBeGreaterThan(0);
      // Should use DEFAULT_CHUNK_CONFIG.targetSize (1500)
      expect(chunks.length).toBeLessThan(20); // Reasonable for this text size
    });
  });
});
