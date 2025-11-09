import { searchWeb } from '../../utils/web-search.js';

export interface WebSearchParams {
  query: string;
  numResults?: number;
}

/**
 * Search the web and return top results
 *
 * @param params - Search parameters
 * @returns Array of search results with title, url, and snippet
 */
export async function webSearch(
  params: WebSearchParams
): Promise<Array<{ title: string; url: string; snippet: string }>> {
  const numResults = params.numResults ?? 5;
  return searchWeb(params.query, numResults);
}

