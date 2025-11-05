import { describe, it, expect } from 'vitest';
import { clarifyAsk } from '@/tools/clarify/askTool.js';

describe('clarifyAsk', () => {
  it('should format question without options', () => {
    const result = clarifyAsk({
      question: 'What would you like to do?',
    });

    expect(result.question).toBe('What would you like to do?');
    expect(result.formatted).toBe('What would you like to do?');
    expect(result.needsResponse).toBe(true);
  });

  it('should format question with options', () => {
    const result = clarifyAsk({
      question: 'What would you like to create?',
      suggestedOptions: [
        'Generate new video ideas',
        'Write a script',
        'Check video status',
      ],
    });

    expect(result.question).toBe('What would you like to create?');
    expect(result.formatted).toContain('What would you like to create?');
    expect(result.formatted).toContain('1. Generate new video ideas');
    expect(result.formatted).toContain('2. Write a script');
    expect(result.formatted).toContain('3. Check video status');
    expect(result.needsResponse).toBe(true);
  });

  it('should handle empty options array', () => {
    const result = clarifyAsk({
      question: 'Test question',
      suggestedOptions: [],
    });

    expect(result.formatted).toBe('Test question');
  });
});

