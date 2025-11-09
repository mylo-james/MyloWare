import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchWebPage } from '@/utils/web-fetch.js';

// Mock fetch globally
global.fetch = vi.fn();

describe('fetchWebPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should extract title and text from HTML', async () => {
    const mockHtml = `
      <html>
        <head><title>Test Page Title</title></head>
        <body>
          <p>This is paragraph one.</p>
          <div>This is paragraph two.</div>
        </body>
      </html>
    `;

    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      text: async () => mockHtml,
    });

    const result = await fetchWebPage('https://example.com');

    expect(result.title).toBe('Test Page Title');
    expect(result.url).toBe('https://example.com');
    expect(result.text).toContain('This is paragraph one');
    expect(result.text).toContain('This is paragraph two');
    expect(result.metadata.fetchedAt).toBeDefined();
  });

  it('should handle missing title gracefully', async () => {
    const mockHtml = '<html><body><p>No title here</p></body></html>';

    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      text: async () => mockHtml,
    });

    const result = await fetchWebPage('https://example.com');

    expect(result.title).toBe('');
    expect(result.text).toContain('No title here');
  });

  it('should strip script and style tags', async () => {
    const mockHtml = `
      <html>
        <head>
          <style>body { color: red; }</style>
          <script>console.log('test');</script>
        </head>
        <body>
          <p>Visible content</p>
        </body>
      </html>
    `;

    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      text: async () => mockHtml,
    });

    const result = await fetchWebPage('https://example.com');

    expect(result.text).toContain('Visible content');
    expect(result.text).not.toContain('color: red');
    expect(result.text).not.toContain('console.log');
  });

  it('should enforce maxChars limit', async () => {
    const longText = 'A'.repeat(60000);
    const mockHtml = `<html><body><p>${longText}</p></body></html>`;

    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      text: async () => mockHtml,
    });

    const result = await fetchWebPage('https://example.com', 1000);

    expect(result.text.length).toBeLessThanOrEqual(1000);
  });

  it('should handle HTTP errors', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    await expect(fetchWebPage('https://example.com')).rejects.toThrow(
      'HTTP 404'
    );
  });

  it('should handle network timeouts', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      () =>
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('AbortError')), 100);
        })
    );

    // Mock AbortController
    const originalAbortController = global.AbortController;
    global.AbortController = vi.fn().mockImplementation(() => ({
      abort: vi.fn(),
      signal: { aborted: false },
    })) as unknown as typeof AbortController;

    await expect(
      fetchWebPage('https://example.com', 50000)
    ).rejects.toThrow();

    global.AbortController = originalAbortController;
  });

  it('should decode HTML entities', async () => {
    const mockHtml = `
      <html>
        <head><title>Test &amp; Example</title></head>
        <body>
          <p>Quote: &quot;Hello&quot; &amp; World</p>
        </body>
      </html>
    `;

    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      text: async () => mockHtml,
    });

    const result = await fetchWebPage('https://example.com');

    expect(result.title).toBe('Test & Example');
    expect(result.text).toContain('Quote: "Hello" & World');
  });
});

