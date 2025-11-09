/**
 * Search the web using DuckDuckGo HTML scraping
 *
 * @param query - Search query
 * @param numResults - Number of results to return (default: 5, max: 10)
 * @returns Array of search results
 */
export async function searchWeb(
  query: string,
  numResults = 5
): Promise<Array<{ title: string; url: string; snippet: string }>> {
  const maxResults = Math.min(Math.max(1, numResults), 10);
  const encodedQuery = encodeURIComponent(query);
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;

  try {
    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      },
    });

    if (!response.ok) {
      throw new Error(`Search failed: HTTP ${response.status}`);
    }

    const html = await response.text();
    const results: Array<{ title: string; url: string; snippet: string }> = [];

    // DuckDuckGo HTML structure: results are in <div class="result">
    // Title is in <a class="result__a">
    // Snippet is in <a class="result__snippet">
    const resultPattern =
      /<div[^>]*class="[^"]*result[^"]*"[^>]*>[\s\S]*?<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>[\s\S]*?<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([^<]+)<\/a>/gi;

    let match;
    let count = 0;

    while ((match = resultPattern.exec(html)) !== null && count < maxResults) {
      const url = match[1].trim();
      const title = match[2].trim().replace(/\s+/g, ' ');
      const snippet = match[3].trim().replace(/\s+/g, ' ');

      if (url && title) {
        results.push({
          title,
          url,
          snippet: snippet || '',
        });
        count++;
      }
    }

    // Fallback: try alternative pattern if no results found
    if (results.length === 0) {
      const linkPattern = /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([^<]+)<\/a>/gi;
      const seenUrls = new Set<string>();

      while ((match = linkPattern.exec(html)) !== null && count < maxResults) {
        const url = match[1].trim();
        const title = match[2].trim().replace(/\s+/g, ' ');

        if (
          url &&
          title &&
          !seenUrls.has(url) &&
          !url.includes('duckduckgo.com') &&
          url.startsWith('http')
        ) {
          results.push({
            title,
            url,
            snippet: '',
          });
          seenUrls.add(url);
          count++;
        }
      }
    }

    return results;
  } catch (error) {
    // Graceful fallback: return empty results instead of throwing
    if (error instanceof Error) {
      console.warn(`Web search failed: ${error.message}`);
    }
    return [];
  }
}

