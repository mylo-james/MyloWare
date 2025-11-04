import { describe, expect, it } from 'vitest';
import { extractToolArgs } from './argUtils';

describe('extractToolArgs', () => {
  it('returns arguments when provided directly', () => {
    const input = { query: 'hello', limit: 5 };
    const result = extractToolArgs(input);
    expect(result).toEqual(input);
  });

  it('unwraps envelopes containing requestInfo.input', () => {
    const raw = {
      requestId: 'req-1',
      requestInfo: {
        input: {
          query: 'nested',
          minSimilarity: 0.4,
        },
      },
    };

    const result = extractToolArgs(raw);
    expect(result).toEqual({ query: 'nested', minSimilarity: 0.4 });
  });

  it('filters to allowed keys when provided', () => {
    const raw = {
      requestInfo: {
        args: { query: 'filter-me', limit: 3, extra: true },
      },
      unexpected: 'value',
    };

    const result = extractToolArgs(raw, { allowedKeys: ['query', 'limit'] });
    expect(result).toEqual({ query: 'filter-me', limit: 3 });
  });

  it('returns an empty object when no suitable payload exists', () => {
    const result = extractToolArgs('not-an-object');
    expect(result).toEqual({});
  });
});



