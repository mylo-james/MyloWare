import { describe, expect, it } from 'vitest';
import { buildEmbeddingRecord, buildVideoMemoryChunk } from './videoArchive';

describe('videoArchive', () => {
  const sampleRecord = {
    videoId: '1234',
    runId: 'abcd',
    concept: 'Glowing Crystal Garden',
    userIdea: 'User submitted concept',
    vibe: 'Ethereal Hypnotic',
    environment: 'Underwater Cave',
    screenplayExcerpt:
      'INT. UNDERWATER CAVE - Glowing crystals hum while a whisper guides the viewer through tactile motions.',
    status: 'complete',
    runStatus: 'complete',
    createdAt: '2025-10-15T12:34:56.000Z',
    completedAt: '2025-10-15T12:40:00.000Z',
    performanceNotes: 'High replay value, 3.2s avg watch time, completion rate 87%.',
    averageWatchTimeSeconds: 3.2,
    completionRate: 0.87,
    additionalMetadata: {
      lightingPalette: 'bioluminescent blues',
      promptTokens: 674,
    },
  };

  it('builds a video memory chunk with formatted text and metadata', () => {
    const chunk = buildVideoMemoryChunk(sampleRecord);

    expect(chunk.chunkId).toBe('video_1234');
    expect(chunk.promptKey).toBe('video_1234');
    expect(chunk.memoryType).toBe('semantic');
    expect(chunk.chunkText).toContain('Glowing Crystal Garden - Ethereal Hypnotic');
    expect(chunk.chunkText).toContain('Environment: Underwater Cave');
    expect(chunk.chunkText).toContain('Performance Notes: High replay value');
    const metadata = chunk.metadata as Record<string, unknown>;
    expect(metadata.project).toEqual(['aismr']);
    expect(metadata.tags).toEqual(
      expect.arrayContaining(['video', 'aismr', 'archive', 'video_execution', 'concept-glowing-crystal-garden']),
    );
    expect(metadata).toMatchObject({
      concept: 'Glowing Crystal Garden',
      vibe: 'Ethereal Hypnotic',
      environment: 'Underwater Cave',
      videoId: '1234',
      runId: 'abcd',
    });
  });

  it('builds an embedding record with checksum and embedding values', () => {
    const chunk = buildVideoMemoryChunk(sampleRecord);
    const embedding = Array.from({ length: 5 }, (_, index) => index * 0.1);
    const record = buildEmbeddingRecord(chunk, embedding);

    expect(record.chunkId).toBe('video_1234');
    expect(record.promptKey).toBe('video_1234');
    expect(record.granularity).toBe('document');
    expect(record.embedding).toEqual(embedding);
    expect(record.rawSource).toBe(chunk.chunkText);
    expect(typeof record.checksum).toBe('string');
    expect(record.checksum).toHaveLength(64);
  });
});
