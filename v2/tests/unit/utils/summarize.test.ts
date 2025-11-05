import { describe, it, expect } from 'vitest';
import { summarizeContent } from '@/utils/summarize.js';
import { openAIMocks } from '../../utils/openaiMocks.ts';

describe('summarize', () => {
  describe('summarizeContent', () => {
    it('should generate single-line summary', async () => {
      openAIMocks.setChatResponse(() => 'This is a concise summary of the content.');

      const summary = await summarizeContent('This is a long piece of content that needs to be summarized into a single sentence.');

      expect(summary).toBe('This is a concise summary of the content.');
      expect(openAIMocks.chatCompletionsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-4o-mini',
          max_tokens: 100,
          temperature: 0.3
        })
      );
    });

    it('should handle long content', async () => {
      const longContent = 'A'.repeat(1000);
      openAIMocks.setChatResponse(() => 'Summary of long content');

      const summary = await summarizeContent(longContent);

      expect(summary).toBe('Summary of long content');
      expect(openAIMocks.chatCompletionsCreate).toHaveBeenCalled();
    });

    it('should use gpt-4o-mini model', async () => {
      openAIMocks.setChatResponse(() => 'Summary');

      await summarizeContent('Test content');

      expect(openAIMocks.chatCompletionsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-4o-mini'
        })
      );
    });

    it('should return empty string if no content', async () => {
      openAIMocks.setChatResponse(() => '');

      const summary = await summarizeContent('Test');

      expect(summary).toBe('');
    });

    it('should clean and trim summary', async () => {
      openAIMocks.setChatResponse(() => '  Summary with extra spaces  \n');

      const summary = await summarizeContent('Test');

      expect(summary).toBe('Summary with extra spaces');
    });
  });
});
