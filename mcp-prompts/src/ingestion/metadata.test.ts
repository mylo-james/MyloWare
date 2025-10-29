import { describe, expect, it } from 'vitest';
import { parsePromptMetadata } from './metadata';

describe('parsePromptMetadata', () => {
  it('parses persona prompts', () => {
    const parsed = parsePromptMetadata('persona-ideagenerator.md');
    expect(parsed.type).toBe('persona');
    expect(parsed.persona).toEqual(['ideagenerator']);
    expect(parsed.project).toEqual([]);
  });

  it('parses project prompts', () => {
    const parsed = parsePromptMetadata('project-aismr.md');
    expect(parsed.type).toBe('project');
    expect(parsed.persona).toEqual([]);
    expect(parsed.project).toEqual(['aismr']);
  });

  it('parses combination prompts using last hyphen as separator', () => {
    const parsed = parsePromptMetadata('ideagenerator-aismr.md');
    expect(parsed.type).toBe('combination');
    expect(parsed.persona).toEqual(['ideagenerator']);
    expect(parsed.project).toEqual(['aismr']);
  });

  it('supports multi-word persona using underscore or plus delimiters', () => {
    const parsed = parsePromptMetadata('persona-product_manager.md');
    expect(parsed.persona).toEqual(['product', 'manager']);
  });

  it('splits combination persona on underscores and project on plus signs', () => {
    const parsed = parsePromptMetadata('growth_hacker-aismr+beta.md');
    expect(parsed.persona).toEqual(['growth', 'hacker']);
    expect(parsed.project).toEqual(['aismr', 'beta']);
  });

  it('normalises casing to lowercase', () => {
    const parsed = parsePromptMetadata('persona-Designer.md');
    expect(parsed.persona).toEqual(['designer']);
  });

  it('handles nested paths by extracting basename', () => {
    const parsed = parsePromptMetadata('nested/path/persona-editor.md');
    expect(parsed.persona).toEqual(['editor']);
  });

  it('throws when persona prefix missing slug', () => {
    expect(() => parsePromptMetadata('persona-.md')).toThrowError();
  });

  it('throws for unsupported extensions', () => {
    expect(() => parsePromptMetadata('persona-ideagenerator.txt')).toThrowError();
  });

  it('throws when unable to determine type', () => {
    expect(() => parsePromptMetadata('invalidprompt.md')).toThrowError();
  });
});
