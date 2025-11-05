import { beforeEach } from 'vitest';
import { setOpenAIClient } from '@/clients/openai.js';
import { openAIMocks } from '../utils/openaiMocks.js';

setOpenAIClient({
  embeddings: {
    create: openAIMocks.embeddingsCreate,
  },
  chat: {
    completions: {
      create: openAIMocks.chatCompletionsCreate,
    },
  },
} as any);

beforeEach(() => {
  openAIMocks.reset();
});
