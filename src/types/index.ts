export interface McpEmbeddings {
  embedTexts(texts: string[]): Promise<number[][]>;
}

export * from './workflow-contracts';
