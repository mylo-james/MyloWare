import { describe, it, expect, beforeEach, vi } from 'vitest';
import { knowledgeIngest } from '@/tools/knowledge/ingestTool.js';
import { MemoryRepository } from '@/db/repositories/memory-repository.js';
import { PersonaRepository } from '@/db/repositories/persona-repository.js';
import { ProjectRepository } from '@/db/repositories/project-repository.js';
import { db } from '@/db/client.js';
import { memories } from '@/db/schema.js';
import { setOpenAIClient } from '@/clients/openai.js';
import { randomUUID } from 'crypto';

/**
 * Knowledge Ingest Integration Tests
 *
 * Tests the knowledge ingestion pipeline end-to-end:
 * - Text chunking
 * - LLM classification
 * - Deduplication
 * - Storage/updates
 */

// Mock fetch for web fetching
global.fetch = vi.fn();

describe('Knowledge Ingest Integration', () => {
  beforeEach(async () => {
    await db.delete(memories);
    vi.clearAllMocks();

    // Setup mock OpenAI client
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    personas: ['iggy'],
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
        create: vi.fn().mockResolvedValue({
          data: [
            {
              embedding: new Array(1536).fill(0.1),
              index: 0,
              object: 'embedding' as const,
            },
          ],
          model: 'text-embedding-3-small',
          object: 'list' as const,
          usage: {
            prompt_tokens: 0,
            total_tokens: 0,
          },
        }),
      },
    };

    setOpenAIClient(mockClient as any);
  });

  it('should ingest text and create memories', async () => {
    // Setup personas and projects
    const personaRepo = new PersonaRepository();
    const projectRepo = new ProjectRepository();

    await personaRepo.insert({
      name: 'iggy',
      description: 'Creative Director',
      capabilities: [],
      tone: 'creative',
      defaultProject: null,
      systemPrompt: null,
      allowedTools: [],
      metadata: {},
    });

    await projectRepo.insert({
      name: 'aismr',
      description: 'AISMR project',
      workflow: [],
      optionalSteps: [],
      guardrails: {},
      settings: {},
      metadata: {},
    });

    const traceId = randomUUID();

    const result = await knowledgeIngest({
      traceId,
      text: 'This is a test knowledge chunk about creative video ideas. It contains useful information for creative directors.',
    });

    expect(result.inserted).toBeGreaterThan(0);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.totalChunks).toBeGreaterThan(0);

    // Verify memory was stored
    const repo = new MemoryRepository();
    const stored = await repo.keywordSearch('creative video ideas', {
      limit: 10,
    });

    expect(stored.length).toBeGreaterThan(0);
    expect(stored[0].persona).toContain('iggy');
    expect(stored[0].project).toContain('aismr');
    expect(stored[0].metadata.traceId).toBe(traceId);
  });

  it('should fetch URLs and ingest content', async () => {
    // Setup personas and projects
    const personaRepo = new PersonaRepository();
    const projectRepo = new ProjectRepository();

    await personaRepo.insert({
      name: 'veo',
      description: 'Production',
      capabilities: [],
      tone: 'technical',
      defaultProject: null,
      systemPrompt: null,
      allowedTools: [],
      metadata: {},
    });

    await projectRepo.insert({
      name: 'aismr',
      description: 'AISMR project',
      workflow: [],
      optionalSteps: [],
      guardrails: {},
      settings: {},
      metadata: {},
    });

    // Mock web fetch
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      text: async () =>
        '<html><head><title>API Documentation</title></head><body><p>This is API documentation about video generation.</p></body></html>',
    });

    const traceId = randomUUID();

    const result = await knowledgeIngest({
      traceId,
      urls: ['https://example.com/api-docs'],
      bias: { persona: ['veo'], project: ['aismr'] },
    });

    expect(result.inserted).toBeGreaterThan(0);
    expect(global.fetch).toHaveBeenCalled();
  });

  it('should deduplicate similar memories', async () => {
    // Setup personas and projects
    const personaRepo = new PersonaRepository();
    const projectRepo = new ProjectRepository();

    await personaRepo.insert({
      name: 'iggy',
      description: 'Creative Director',
      capabilities: [],
      tone: 'creative',
      defaultProject: null,
      systemPrompt: null,
      allowedTools: [],
      metadata: {},
    });

    await projectRepo.insert({
      name: 'aismr',
      description: 'AISMR project',
      workflow: [],
      optionalSteps: [],
      guardrails: {},
      settings: {},
      metadata: {},
    });

    const traceId = randomUUID();

    // First ingestion
    const result1 = await knowledgeIngest({
      traceId,
      text: 'Creative video idea: Rain sounds with surreal modifiers.',
    });

    expect(result1.inserted).toBeGreaterThan(0);

    // Second ingestion with similar content (should update, not insert)
    // Use same embedding to simulate similarity
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    personas: ['iggy'],
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
        create: vi.fn().mockResolvedValue({
          data: [
            {
              embedding: new Array(1536).fill(0.1), // Same embedding = high similarity
              index: 0,
              object: 'embedding' as const,
            },
          ],
          model: 'text-embedding-3-small',
          object: 'list' as const,
          usage: {
            prompt_tokens: 0,
            total_tokens: 0,
          },
        }),
      },
    };

    setOpenAIClient(mockClient as any);

    const result2 = await knowledgeIngest({
      traceId,
      text: 'Creative video idea: Rain sounds with surreal modifiers.',
      minSimilarity: 0.92,
    });

    // Should update existing memory, not insert new one
    expect(result2.updated).toBeGreaterThan(0);
    expect(result2.inserted).toBe(0);
  });

  it('should merge bias with classification', async () => {
    // Setup personas and projects
    const personaRepo = new PersonaRepository();
    const projectRepo = new ProjectRepository();

    await personaRepo.insert({
      name: 'iggy',
      description: 'Creative Director',
      capabilities: [],
      tone: 'creative',
      defaultProject: null,
      systemPrompt: null,
      allowedTools: [],
      metadata: {},
    });

    await personaRepo.insert({
      name: 'riley',
      description: 'Head Writer',
      capabilities: [],
      tone: 'precise',
      defaultProject: null,
      systemPrompt: null,
      allowedTools: [],
      metadata: {},
    });

    await projectRepo.insert({
      name: 'aismr',
      description: 'AISMR project',
      workflow: [],
      optionalSteps: [],
      guardrails: {},
      settings: {},
      metadata: {},
    });

    const traceId = randomUUID();

    // Mock classification that returns only 'iggy', but we bias with 'riley'
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    personas: ['iggy'],
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
        create: vi.fn().mockResolvedValue({
          data: [
            {
              embedding: new Array(1536).fill(0.2), // Different embedding
              index: 0,
              object: 'embedding' as const,
            },
          ],
          model: 'text-embedding-3-small',
          object: 'list' as const,
          usage: {
            prompt_tokens: 0,
            total_tokens: 0,
          },
        }),
      },
    };

    setOpenAIClient(mockClient as any);

    const result = await knowledgeIngest({
      traceId,
      text: 'Test knowledge about writing and creativity.',
      bias: { persona: ['riley'], project: ['aismr'] },
    });

    expect(result.inserted).toBeGreaterThan(0);

    // Verify memory has both personas
    const repo = new MemoryRepository();
    const stored = await repo.keywordSearch('writing creativity', {
      limit: 10,
    });

    expect(stored.length).toBeGreaterThan(0);
    expect(stored[0].persona).toContain('iggy');
    expect(stored[0].persona).toContain('riley'); // Bias should be merged
  });

  it('should handle empty input gracefully', async () => {
    const traceId = randomUUID();

    const result = await knowledgeIngest({
      traceId,
    });

    expect(result.inserted).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.totalChunks).toBe(0);
  });

  it('should handle fetch failures gracefully', async () => {
    // Setup personas and projects
    const personaRepo = new PersonaRepository();
    const projectRepo = new ProjectRepository();

    await personaRepo.insert({
      name: 'veo',
      description: 'Production',
      capabilities: [],
      tone: 'technical',
      defaultProject: null,
      systemPrompt: null,
      allowedTools: [],
      metadata: {},
    });

    await projectRepo.insert({
      name: 'aismr',
      description: 'AISMR project',
      workflow: [],
      optionalSteps: [],
      guardrails: {},
      settings: {},
      metadata: {},
    });

    // Mock fetch failure
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    const traceId = randomUUID();

    const result = await knowledgeIngest({
      traceId,
      urls: ['https://example.com/not-found'],
    });

    // Should skip failed URLs but not crash
    expect(result.inserted).toBe(0);
    expect(result.skipped).toBe(0); // URLs are skipped before chunking
  });
});

