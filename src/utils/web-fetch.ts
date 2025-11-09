import { config } from '../config/index.js';

/**
 * Decode HTML entities
 */
function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&nbsp;': ' ',
  };

  return text.replace(/&[#\w]+;/g, (entity) => {
    return entities[entity] || entity;
  });
}

/**
 * Extract title from HTML
 */
function extractTitle(html: string): string {
  const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/is);
  if (titleMatch && titleMatch[1]) {
    return decodeHtmlEntities(titleMatch[1].trim());
  }
  return '';
}

/**
 * Convert HTML to plain text
 */
function htmlToText(html: string): string {
  // Remove script and style tags
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

  // Replace common block elements with newlines
  text = text.replace(/<\/?(p|div|h[1-6]|li|br|tr|td|th)[^>]*>/gi, '\n');

  // Remove all remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode HTML entities
  text = decodeHtmlEntities(text);

  // Normalize whitespace
  text = text.replace(/\s+/g, ' ').trim();

  return text;
}

export interface FetchWebPageResult {
  title: string;
  url: string;
  text: string;
  metadata: {
    fetchedAt: string;
  };
}

/**
 * Fetch a web page and extract readable text
 *
 * @param url - URL to fetch
 * @param maxChars - Maximum characters to return (default: 50000)
 * @returns Extracted content with metadata
 */
export async function fetchWebPage(
  url: string,
  maxChars = 50000
): Promise<FetchWebPageResult> {
  const userAgent = config.web?.userAgent || 'MyloWareBot/1.0';
  const timeoutMs = config.web?.timeoutMs || 10000;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': userAgent,
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    const title = extractTitle(html);
    let text = htmlToText(html);

    // Enforce max length
    if (text.length > maxChars) {
      text = text.slice(0, maxChars);
    }

    return {
      title,
      url,
      text: text.trim(),
      metadata: {
        fetchedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }
    throw error;
  }
}

