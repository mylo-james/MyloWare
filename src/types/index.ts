export interface McpEmbeddings {
  embedTexts(texts: string[]): Promise<number[][]>;
}
