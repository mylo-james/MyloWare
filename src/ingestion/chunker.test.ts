import { describe, expect, it } from 'vitest';
import { chunkPrompt } from './chunker';

describe('chunkPrompt', () => {
  const sampleMarkdown = `# Title\n\nParagraph one with some text to test splitting.\n\n## Section\n\nParagraph two continues with additional sentences to ensure we have enough content for multiple chunks.\n\n### Subsection\n\nFinal paragraph to round things off.`;

  it('includes a document-level chunk', () => {
    const chunks = chunkPrompt({
      filePath: 'prompts/sample.json',
      checksum: 'abc123',
      markdown: sampleMarkdown,
    });

    const documentChunk = chunks.find((chunk) => chunk.granularity === 'document');
    expect(documentChunk).toBeDefined();
    expect(documentChunk?.id).toBe('abc123-document-0');
    expect(documentChunk?.text).toContain('# Title');
  });

  it('produces additional granular chunks with custom chunk size', () => {
    const chunks = chunkPrompt({
      filePath: 'prompts/sample.json',
      checksum: 'abc123',
      markdown: sampleMarkdown.repeat(4),
      options: {
        chunkSize: 50,
        chunkOverlap: 10,
      },
    });

    const chunkGranular = chunks.filter((chunk) => chunk.granularity === 'chunk');
    expect(chunkGranular.length).toBeGreaterThan(1);
    expect(new Set(chunkGranular.map((chunk) => chunk.id)).size).toEqual(chunkGranular.length);
  });

  it('omits empty chunks', () => {
    const chunks = chunkPrompt({
      filePath: 'prompts/empty.json',
      checksum: 'empty',
      markdown: '',
    });

    const granular = chunks.filter((chunk) => chunk.granularity === 'chunk');
    expect(granular.length).toBe(0);
  });
});
