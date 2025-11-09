import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  classifyTargets,
  buildClassificationPrompt,
  extractJSON,
  validateClassification,
  ClassificationError,
} from '@/utils/classify.js';
import { setOpenAIClient } from '@/clients/openai.js';

/**
 * Unit tests for knowledge classification utility
 *
 * Tests LLM-based classification:
 * - Prompt building
 * - JSON extraction (handles markdown)
 * - Validation and sanitization
 * - Error handling and retries
 */
describe('classify utility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('buildClassificationPrompt', () => {
    it('should build prompt with candidates', () => {
      const prompt = buildClassificationPrompt({
        personas: ['iggy', 'riley'],
        projects: ['aismr'],
      });

      expect(prompt).toContain('iggy');
      expect(prompt).toContain('riley');
      expect(prompt).toContain('aismr');
      expect(prompt).toContain('semantic');
      expect(prompt).toContain('procedural');
      expect(prompt).toContain('episodic');
    });

    it('should handle empty candidates', () => {
      const prompt = buildClassificationPrompt({
        personas: [],
        projects: [],
      });

      expect(prompt).toContain('Available personas:');
      expect(prompt).toContain('Available projects:');
    });
  });

  describe('extractJSON', () => {
    it('should extract JSON from plain response', () => {
      const json = '{"personas": ["iggy"], "projects": ["aismr"], "memoryType": "semantic"}';
      const result = extractJSON(json);
      expect(result).toBe(json);
    });

    it('should extract JSON from markdown code block', () => {
      const response = '```json\n{"personas": ["iggy"], "projects": ["aismr"], "memoryType": "semantic"}\n```';
      const result = extractJSON(response);
      expect(result).toBe('{"personas": ["iggy"], "projects": ["aismr"], "memoryType": "semantic"}');
    });

    it('should extract JSON from code block without language tag', () => {
      const response = '```\n{"personas": ["iggy"], "projects": ["aismr"], "memoryType": "semantic"}\n```';
      const result = extractJSON(response);
      expect(result).toBe('{"personas": ["iggy"], "projects": ["aismr"], "memoryType": "semantic"}');
    });

    it('should extract JSON with surrounding text', () => {
      const response = 'Here is the result: {"personas": ["iggy"], "projects": ["aismr"], "memoryType": "semantic"} end';
      const result = extractJSON(response);
      expect(result).toContain('{"personas": ["iggy"]');
    });
  });

  describe('validateClassification', () => {
    it('should validate correct classification', () => {
      const parsed = {
        personas: ['iggy', 'riley'],
        projects: ['aismr'],
        memoryType: 'semantic',
      };

      const result = validateClassification(parsed, {
        personas: ['iggy', 'riley', 'veo'],
        projects: ['aismr', 'general'],
      });

      expect(result.personas).toEqual(['iggy', 'riley']);
      expect(result.projects).toEqual(['aismr']);
      expect(result.memoryType).toBe('semantic');
    });

    it('should filter invalid personas and projects', () => {
      const parsed = {
        personas: ['iggy', 'invalid_persona'],
        projects: ['aismr', 'invalid_project'],
        memoryType: 'semantic',
      };

      const result = validateClassification(parsed, {
        personas: ['iggy'],
        projects: ['aismr'],
      });

      expect(result.personas).toEqual(['iggy']);
      expect(result.projects).toEqual(['aismr']);
    });

    it('should default invalid memory types to semantic', () => {
      const parsed = {
        personas: [],
        projects: [],
        memoryType: 'invalid_type',
      };

      const result = validateClassification(parsed, {
        personas: [],
        projects: [],
      });

      expect(result.memoryType).toBe('semantic');
    });

    it('should handle missing fields', () => {
      const parsed = {};

      const result = validateClassification(parsed, {
        personas: ['iggy'],
        projects: ['aismr'],
      });

      expect(result.personas).toEqual([]);
      expect(result.projects).toEqual([]);
      expect(result.memoryType).toBe('semantic');
    });

    it('should handle null/undefined input', () => {
      const result1 = validateClassification(null, {
        personas: ['iggy'],
        projects: ['aismr'],
      });

      expect(result1.personas).toEqual([]);
      expect(result1.memoryType).toBe('semantic');

      const result2 = validateClassification(undefined, {
        personas: ['iggy'],
        projects: ['aismr'],
      });

      expect(result2.personas).toEqual([]);
    });
  });

  describe('classifyTargets', () => {
    it('should validate input', async () => {
      await expect(
        classifyTargets('', {
          personas: ['iggy'],
          projects: ['aismr'],
        })
      ).rejects.toThrow(ClassificationError);

      await expect(
        classifyTargets('text', {
          personas: null as any,
          projects: ['aismr'],
        })
      ).rejects.toThrow(ClassificationError);

      await expect(
        classifyTargets('text', {
          personas: ['iggy'],
          projects: null as any,
        })
      ).rejects.toThrow(ClassificationError);
  });

  it('should parse valid JSON classification', async () => {
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    personas: ['iggy', 'riley'],
                    projects: ['aismr'],
                    memoryType: 'semantic',
                  }),
                },
              },
            ],
          }),
        },
      },
      embeddings: {
        create: vi.fn(),
      },
    };

    setOpenAIClient(mockClient as any);

    const result = await classifyTargets('Test text', {
      personas: ['casey', 'iggy', 'riley', 'veo'],
      projects: ['aismr', 'general'],
    });

    expect(result.personas).toEqual(['iggy', 'riley']);
    expect(result.projects).toEqual(['aismr']);
    expect(result.memoryType).toBe('semantic');
  });

  it('should filter out invalid persona/project names', async () => {
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    personas: ['iggy', 'invalid-persona'],
                    projects: ['aismr', 'invalid-project'],
                    memoryType: 'procedural',
                  }),
                },
              },
            ],
          }),
        },
      },
      embeddings: {
        create: vi.fn(),
      },
    };

    setOpenAIClient(mockClient as any);

    const result = await classifyTargets('Test text', {
      personas: ['iggy', 'riley'],
      projects: ['aismr'],
    });

    expect(result.personas).toEqual(['iggy']);
    expect(result.projects).toEqual(['aismr']);
    expect(result.personas).not.toContain('invalid-persona');
    expect(result.projects).not.toContain('invalid-project');
  });

  it('should handle markdown-wrapped JSON', async () => {
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  content: '```json\n{"personas": ["veo"], "projects": ["aismr"], "memoryType": "episodic"}\n```',
                },
              },
            ],
          }),
        },
      },
      embeddings: {
        create: vi.fn(),
      },
    };

    setOpenAIClient(mockClient as any);

    const result = await classifyTargets('Test text', {
      personas: ['veo'],
      projects: ['aismr'],
    });

    expect(result.personas).toEqual(['veo']);
    expect(result.projects).toEqual(['aismr']);
    expect(result.memoryType).toBe('episodic');
  });

  it('should fallback to empty arrays on invalid JSON', async () => {
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  content: 'Invalid JSON response',
                },
              },
            ],
          }),
        },
      },
      embeddings: {
        create: vi.fn(),
      },
    };

    setOpenAIClient(mockClient as any);

    const result = await classifyTargets('Test text', {
      personas: ['iggy'],
      projects: ['aismr'],
    });

    expect(result.personas).toEqual([]);
    expect(result.projects).toEqual([]);
    expect(result.memoryType).toBe('semantic'); // Default fallback
  });

  it('should default to semantic memory type', async () => {
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    personas: [],
                    projects: [],
                    memoryType: 'invalid-type',
                  }),
                },
              },
            ],
          }),
        },
      },
      embeddings: {
        create: vi.fn(),
      },
    };

    setOpenAIClient(mockClient as any);

    const result = await classifyTargets('Test text', {
      personas: ['iggy'],
      projects: ['aismr'],
    });

    expect(result.memoryType).toBe('semantic');
  });

  it('should handle procedural memory type', async () => {
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    personas: ['veo'],
                    projects: ['aismr'],
                    memoryType: 'procedural',
                  }),
                },
              },
            ],
          }),
        },
      },
      embeddings: {
        create: vi.fn(),
      },
    };

    setOpenAIClient(mockClient as any);

    const result = await classifyTargets('How to generate video', {
      personas: ['veo'],
      projects: ['aismr'],
    });

    expect(result.memoryType).toBe('procedural');
  });

  it('should handle episodic memory type', async () => {
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    personas: ['casey'],
                    projects: ['aismr'],
                    memoryType: 'episodic',
                  }),
                },
              },
            ],
          }),
        },
      },
      embeddings: {
        create: vi.fn(),
      },
    };

    setOpenAIClient(mockClient as any);

    const result = await classifyTargets('Trace completed successfully', {
      personas: ['casey'],
      projects: ['aismr'],
    });

    expect(result.memoryType).toBe('episodic');
  });
});
});
