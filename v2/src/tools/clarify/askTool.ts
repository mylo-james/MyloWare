export interface ClarifyAskParams {
  question: string;
  suggestedOptions?: string[];
}

export interface ClarifyAskResult {
  question: string;
  formatted: string;
  needsResponse: boolean;
}

/**
 * Format a clarification question with optional suggested options
 *
 * @param params - Question and optional suggested options
 * @returns Formatted question ready for user display
 */
export function clarifyAsk(params: ClarifyAskParams): ClarifyAskResult {
  const { question, suggestedOptions } = params;

  let formatted = question;

  if (suggestedOptions && suggestedOptions.length > 0) {
    formatted += '\n\n';
    formatted += suggestedOptions
      .map((option, index) => `${index + 1}. ${option}`)
      .join('\n');
  }

  return {
    question,
    formatted,
    needsResponse: true,
  };
}

