import type { PersonaGetParams, PersonaGetResult } from '../../types/context.js';
import { PersonaRepository } from '../../db/repositories/persona-repository.js';

/**
 * Get persona configuration by name
 *
 * @param params - Persona retrieval parameters
 * @returns Persona configuration
 * @throws {Error} If persona not found
 */
export async function getPersona(
  params: PersonaGetParams
): Promise<PersonaGetResult> {
  const repository = new PersonaRepository();

  // 1. Fetch persona
  const persona = await repository.findByName(params.personaName);

  if (!persona) {
    throw new Error(`Persona not found: ${params.personaName}`);
  }

  // 2. Format response
  return {
    persona: {
      name: persona.name,
      description: persona.description,
      capabilities: persona.capabilities,
      tone: persona.tone,
      defaultProject: persona.defaultProject,
      systemPrompt: persona.systemPrompt,
    },
    metadata: persona.metadata,
  };
}

