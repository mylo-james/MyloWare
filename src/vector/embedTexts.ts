import OpenAI from 'openai';
import { config } from '../config';

const client = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
});

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  const response = await client.embeddings.create({
    input: texts,
    model: config.OPENAI_EMBEDDING_MODEL,
  });

  return response.data.map((item) => item.embedding);
}
