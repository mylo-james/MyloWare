import { fetchWebPage } from '../../utils/web-fetch.js';

export interface WebReadParams {
  url: string;
  maxChars?: number;
}

/**
 * Fetch and extract text from a URL
 *
 * @param params - Read parameters
 * @returns Extracted content with title, url, text, and metadata
 */
export async function webRead(params: WebReadParams) {
  const maxChars = params.maxChars ?? 50000;
  return fetchWebPage(params.url, maxChars);
}

