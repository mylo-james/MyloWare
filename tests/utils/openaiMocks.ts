import { vi } from 'vitest';

const VECTOR_DIMENSIONS = 1536;

function defaultEmbeddingGenerator(input: unknown, index: number): number[] {
  const base = typeof input === 'string' ? input : JSON.stringify(input);
  const vector = new Array(VECTOR_DIMENSIONS).fill(0);
  vector[0] = Math.min(base.length + index, 1024);
  vector[1] = index;
  return vector;
}

let embeddingGenerator = defaultEmbeddingGenerator;
let chatResponseFactory: (payload: Record<string, unknown>) => string = () =>
  'Mock summary';

const embeddingsCreate = vi.fn(async ({ input }: { input: string | string[] }) => {
  const inputs = Array.isArray(input) ? input : [input];
  return {
    data: inputs.map((value, idx) => ({
      embedding: embeddingGenerator(value, idx),
    })),
  };
});

const chatCompletionsCreate = vi.fn(async (payload: Record<string, unknown>) => {
  return {
    choices: [
      {
        message: {
          content: chatResponseFactory(payload),
        },
      },
    ],
  };
});

export const openAIMocks = {
  embeddingsCreate,
  chatCompletionsCreate,
  setChatResponse(factory: (payload: Record<string, unknown>) => string) {
    chatResponseFactory = factory;
  },
  setEmbeddingGenerator(factory: typeof embeddingGenerator) {
    embeddingGenerator = factory;
  },
  reset() {
    embeddingsCreate.mockClear();
    chatCompletionsCreate.mockClear();
    embeddingGenerator = defaultEmbeddingGenerator;
    chatResponseFactory = () => 'Mock summary';
  },
};
