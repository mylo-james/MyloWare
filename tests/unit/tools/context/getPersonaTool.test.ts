import { describe, it, expect, beforeEach } from 'vitest';
import { getPersona } from '@/tools/context/getPersonaTool.js';

describe('getPersona', () => {
  beforeEach(async () => {
    // Seed data should already include casey persona
  });

  it('should load persona by name', async () => {
    const result = await getPersona({
      personaName: 'chat',
    });

    expect(result.persona.name).toBe('chat');
    expect(result.persona.description).toBeDefined();
    expect(result.persona.capabilities).toBeInstanceOf(Array);
    expect(result.persona.tone).toBeDefined();
  });

  it('should throw error for unknown persona', async () => {
    await expect(
      getPersona({ personaName: 'unknown-persona' })
    ).rejects.toThrow('Persona not found');
  });

  it('should include system prompt if available', async () => {
    const result = await getPersona({
      personaName: 'chat',
    });

    // System prompt may be null for basic personas
    expect(result.persona.systemPrompt).toBeDefined();
  });
});

