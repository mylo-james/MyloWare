import { ValidationError as ValidationErrorBase } from './errors.js';

export class ValidationError extends ValidationErrorBase {
  constructor(message: string) {
    super(message, 'content');
  }
}

export function validateSingleLine(text: string, fieldName = 'text'): string {
  if (text.includes('\n')) {
    throw new ValidationError(`${fieldName} contains newlines`);
  }
  return text;
}

export function cleanForAI(text: string): string {
  return text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
}

