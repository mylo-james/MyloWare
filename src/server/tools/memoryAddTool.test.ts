import { describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js' with { 'resolution-mode': 'import' };
import {
  addMemory,
  updateMemory,
  deleteMemory,
  registerMemoryTools,
  type MemoryAddOutput,
  type MemoryUpdateOutput,
  type MemoryDeleteOutput,
} from './memoryAddTool';

function createDependencies() {
  const repository = {
    upsertEmbeddings: vi.fn().mockResolvedValue(1),
    getChunksByIds: vi.fn(),
    getChunkEmbedding: vi.fn(),
  };

  const linkRepository = {
    upsertLinks: vi.fn().mockResolvedValue(1),
    deleteLinksForSource: vi.fn().mockResolvedValue(0),
    deleteLinksForChunk: vi.fn().mockResolvedValue(0),
  };

  const embed = vi.fn(async (texts: string[]) =>
    texts.map(() => [0.12, 0.34, 0.56]),
  );

  const moderate = vi.fn(async () => ({
    flagged: false,
    categories: [] as string[],
  }));

  const now = vi.fn(() => new Date('2025-10-31T17:00:00.000Z'));
  const idGenerator = vi.fn(() => '11111111-2222-3333-4444-555555555555');

  return {
    repository,
    linkRepository,
    embed,
    moderate,
    now,
    idGenerator,
  };
}

describe('memoryAddTool', () => {
  it('adds memory with metadata and links', async () => {
    const deps = createDependencies();
    const args = {
      content: 'New semantic insight about AISMR workflows.',
      memoryType: 'semantic' as const,
      title: 'AISMR Workflow Insight',
      summary: 'Key insight about AISMR workflow ordering.',
      tags: ['Workflow', 'AISMR'],
      relatedChunkIds: ['chunk-existing'],
      actor: {
        type: 'agent' as const,
        id: 'agent-1',
      },
    };

    const output = (await addMemory(args, deps)) as MemoryAddOutput;

    expect(output.memoryId).toBeDefined();
    expect(output.moderationStatus).toBe('accepted');
    expect(deps.repository.upsertEmbeddings).toHaveBeenCalledTimes(1);
    const record = deps.repository.upsertEmbeddings.mock.calls[0][0][0];
    expect(record.chunkText).toContain('New semantic insight');
    expect(record.metadata.tags).toEqual(['workflow', 'aismr']);
    expect(record.metadata.status).toBe('active');
    expect(deps.linkRepository.upsertLinks).toHaveBeenCalledWith([
      expect.objectContaining({
        sourceChunkId: output.memoryId,
        targetChunkId: 'chunk-existing',
        linkType: 'related',
      }),
    ]);
    expect(deps.embed).toHaveBeenCalledTimes(1);
    expect(deps.moderate).toHaveBeenCalledTimes(1);
  });

  it('rejects flagged content for agents', async () => {
    const deps = createDependencies();
    deps.moderate.mockResolvedValueOnce({
      flagged: true,
      categories: ['violence'],
    });

    await expect(
      addMemory(
        {
          content: 'Flagged content',
          memoryType: 'semantic',
          title: 'Flagged',
          actor: { type: 'agent', id: 'agent-1' },
        },
        deps,
      ),
    ).rejects.toThrow(/failed moderation/i);
  });

  it('allows operators to override moderation with pending review', async () => {
    const deps = createDependencies();
    deps.moderate.mockResolvedValueOnce({
      flagged: true,
      categories: ['self-harm'],
    });

    const output = await addMemory(
      {
        content: 'Sensitive operational note',
        memoryType: 'project',
        title: 'Sensitive Note',
        actor: { type: 'operator', id: 'operator-7' },
        force: true,
      },
      deps,
    );

    const record = deps.repository.upsertEmbeddings.mock.calls[0][0][0];
    expect(record.metadata.moderation.status).toBe('pending_review');
    expect(output.moderationStatus).toBe('pending_review');
  });

  it('updates memory with re-embedding and link replacement', async () => {
    const deps = createDependencies();
    deps.repository.getChunksByIds.mockResolvedValueOnce([
      {
        chunkId: 'memory-1',
        promptKey: 'runtime::semantic::insight',
        chunkText: 'Old content',
        rawSource: 'Old content',
        granularity: 'runtime',
        metadata: { createdBy: 'agent-1', tags: ['old'] },
        checksum: 'old',
        memoryType: 'semantic',
        updatedAt: '2025-10-30T00:00:00.000Z',
      },
    ]);
    deps.repository.getChunkEmbedding.mockResolvedValueOnce({
      chunkId: 'memory-1',
      promptKey: 'runtime::semantic::insight',
      embedding: [0.01, 0.02, 0.03],
      memoryType: 'semantic',
      metadata: {},
    });

    const output = (await updateMemory(
      {
        memoryId: 'memory-1',
        content: 'Updated content with new details.',
        summary: 'Updated summary',
        tags: ['updated', 'workflow'],
        relatedChunkIds: ['chunk-2', 'chunk-3'],
        actor: { type: 'agent', id: 'agent-1' },
      },
      deps,
    )) as MemoryUpdateOutput;

    expect(output.version).toBeGreaterThan(1);
    expect(deps.embed).toHaveBeenCalledTimes(1);
    expect(deps.linkRepository.deleteLinksForSource).toHaveBeenCalledWith('memory-1');
    expect(deps.linkRepository.upsertLinks).toHaveBeenCalledTimes(1);
    const updatedRecord = deps.repository.upsertEmbeddings.mock.calls[0][0][0];
    expect(updatedRecord.metadata.tags).toEqual(['updated', 'workflow']);
    expect(updatedRecord.metadata.history).toBeDefined();
  });

  it('updates metadata without re-embedding when content unchanged', async () => {
    const deps = createDependencies();
    deps.repository.getChunksByIds.mockResolvedValueOnce([
      {
        chunkId: 'memory-2',
        promptKey: 'runtime::semantic::note',
        chunkText: 'Current content',
        rawSource: 'Current content',
        granularity: 'runtime',
        metadata: { createdBy: 'agent-1', tags: ['current'] },
        checksum: 'current',
        memoryType: 'semantic',
        updatedAt: '2025-10-30T00:00:00.000Z',
      },
    ]);
    deps.repository.getChunkEmbedding.mockResolvedValueOnce({
      chunkId: 'memory-2',
      promptKey: 'runtime::semantic::note',
      embedding: [0.05, 0.05, 0.05],
      memoryType: 'semantic',
      metadata: {},
    });

    const output = (await updateMemory(
      {
        memoryId: 'memory-2',
        tags: ['current', 'refined'],
        actor: { type: 'agent', id: 'agent-1' },
      },
      deps,
    )) as MemoryUpdateOutput;

    expect(output.contentChanged).toBe(false);
    expect(deps.embed).not.toHaveBeenCalled();
    const updatedRecord = deps.repository.upsertEmbeddings.mock.calls[0][0][0];
    expect(updatedRecord.metadata.tags).toEqual(['current', 'refined']);
  });

  it('deletes memory and marks it inactive', async () => {
    const deps = createDependencies();
    deps.repository.getChunksByIds.mockResolvedValueOnce([
      {
        chunkId: 'memory-3',
        promptKey: 'runtime::semantic::note',
        chunkText: 'Content',
        rawSource: 'Content',
        granularity: 'runtime',
        metadata: { createdBy: 'operator-1' },
        checksum: 'checksum',
        memoryType: 'semantic',
        updatedAt: '2025-10-30T00:00:00.000Z',
      },
    ]);
    deps.repository.getChunkEmbedding.mockResolvedValueOnce({
      chunkId: 'memory-3',
      promptKey: 'runtime::semantic::note',
      embedding: [0.1, 0.1, 0.1],
      memoryType: 'semantic',
      metadata: {},
    });

    const output = (await deleteMemory(
      {
        memoryId: 'memory-3',
        reason: 'Outdated information',
        actor: { type: 'operator', id: 'operator-1' },
      },
      deps,
    )) as MemoryDeleteOutput;

    expect(output.status).toBe('inactive');
    const record = deps.repository.upsertEmbeddings.mock.calls[0][0][0];
    expect(record.metadata.status).toBe('inactive');
    expect(record.metadata.deletedReason).toBe('Outdated information');
    expect(deps.linkRepository.deleteLinksForChunk).toHaveBeenCalledWith('memory-3');
  });

  it('registers all memory tools', async () => {
    const server = {
      registerTool: vi.fn(),
    };

    const deps = createDependencies();

    registerMemoryTools(server as unknown as McpServer, deps);

    expect(server.registerTool).toHaveBeenCalledTimes(3);

    const addHandler = server.registerTool.mock.calls[0][2];
    const updateHandler = server.registerTool.mock.calls[1][2];
    const deleteHandler = server.registerTool.mock.calls[2][2];

    deps.repository.getChunksByIds.mockResolvedValue([
      {
        chunkId: 'memory-4',
        promptKey: 'runtime::semantic::demo',
        chunkText: 'Demo',
        rawSource: 'Demo',
        granularity: 'runtime',
        metadata: { createdBy: 'system' },
        checksum: 'checksum',
        memoryType: 'semantic',
        updatedAt: '2025-10-30T00:00:00.000Z',
      },
    ]);
    deps.repository.getChunkEmbedding.mockResolvedValue({
      chunkId: 'memory-4',
      promptKey: 'runtime::semantic::demo',
      embedding: [0.2, 0.2, 0.2],
      memoryType: 'semantic',
      metadata: {},
    });

    const addResult = await addHandler({
      content: 'Tool invocation content',
      memoryType: 'semantic',
      title: 'Tool Memory',
      actor: { type: 'agent', id: 'agent-1' },
    });
    expect(addResult.structuredContent).toMatchObject({ status: 'created' });

    const updateResult = await updateHandler({
      memoryId: 'memory-4',
      summary: 'Updated via tool',
      actor: { type: 'system', id: 'system' },
    });
    expect(updateResult.structuredContent).toMatchObject({ status: 'updated' });

    const deleteResult = await deleteHandler({
      memoryId: 'memory-4',
      actor: { type: 'system', id: 'system' },
    });
    expect(deleteResult.structuredContent).toMatchObject({ status: 'inactive' });
  });
});
