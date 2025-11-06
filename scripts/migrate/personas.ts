#!/usr/bin/env tsx
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { PersonaRepository } from '../../src/db/repositories/persona-repository.js';
import { pool } from '../../src/db/client.js';
import { cleanForAI } from '../../src/utils/validation.js';

interface V1Persona {
  agent: {
    name: string;
    id: string;
    title: string;
    whentouse: string;
  };
  persona: {
    role: string;
    style: string;
    identity: string;
    focus: string;
    core_principles?: string[];
  };
  tools?: {
    overview: string;
  };
  workflow?: {
    definition_of_success?: string;
  };
}

async function migratePersonas() {
  console.log('🔄 Migrating personas from V1...');

  const repository = new PersonaRepository();

  const dataDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'data',
    'personas'
  );

  try {
    // Migrate chat persona
    console.log('  - Migrating chat persona...');
    const chatJson = await readFile(path.join(dataDir, 'chat.json'), 'utf-8');
    const chat: V1Persona = JSON.parse(chatJson);

    // Check if already exists
    const existingChat = await repository.findByName(chat.agent.id);
    if (existingChat) {
      console.log('    ⏭️  Chat persona already exists, skipping');
    } else {
      const chatSystemPrompt = cleanForAI(`
You are a ${chat.persona.role}.
Your style: ${chat.persona.style}.
Your identity: ${chat.persona.identity}.
Your focus areas: ${chat.persona.focus}.

Core principles:
${(chat.persona.core_principles || []).map((p, i) => `${i + 1}. ${p}`).join(' ')}

When to use you: ${chat.agent.whentouse}
      `.trim());

      await repository.insert({
        name: chat.agent.id,
        description: chat.agent.title,
        capabilities: ['conversation', 'orchestration', 'workflow-discovery'],
        tone: 'friendly',
        defaultProject: 'aismr',
        systemPrompt: chatSystemPrompt,
        metadata: {
          v1Source: 'persona-chat.json',
          role: chat.persona.role,
          focus: chat.persona.focus,
        },
      });

      console.log('    ✓ Chat persona migrated');
    }

    // Migrate Idea Generator
    console.log('  - Migrating Idea Generator...');
    const iggyJson = await readFile(path.join(dataDir, 'ideagenerator.json'), 'utf-8');
    const iggy: V1Persona = JSON.parse(iggyJson);

    const existingIggy = await repository.findByName(iggy.agent.id);
    if (existingIggy) {
      console.log('    ⏭️  Idea Generator already exists, skipping');
    } else {
      const iggySystemPrompt = cleanForAI(`
You are ${iggy.agent.name}, a ${iggy.persona.role}.
Your style: ${iggy.persona.style}.
Your identity: ${iggy.persona.identity}.
Your focus areas: ${iggy.persona.focus}.

Core principles:
${(iggy.persona.core_principles || []).map((p, i) => `${i + 1}. ${p}`).join(' ')}

When to use you: ${iggy.agent.whentouse}
Definition of success: ${iggy.workflow?.definition_of_success || 'Generate unique, executable AISMR ideas'}
      `.trim());

      await repository.insert({
        name: iggy.agent.id,
        description: iggy.agent.title,
        capabilities: ['idea-generation', 'uniqueness-verification', 'memory-search'],
        tone: 'creative',
        defaultProject: 'aismr',
        systemPrompt: iggySystemPrompt,
        metadata: {
          v1Source: 'persona-ideagenerator.json',
          role: iggy.persona.role,
          focus: iggy.persona.focus,
        },
      });

      console.log('    ✓ Idea Generator migrated');
    }

    // Migrate Screenwriter
    console.log('  - Migrating Screenwriter...');
    const screenwriterJson = await readFile(path.join(dataDir, 'screenwriter.json'), 'utf-8');
    const screenwriter: V1Persona = JSON.parse(screenwriterJson);

    const existingScreenwriter = await repository.findByName(screenwriter.agent.id);
    if (existingScreenwriter) {
      console.log('    ⏭️  Screenwriter already exists, skipping');
    } else {
      const screenwriterSystemPrompt = cleanForAI(`
You are ${screenwriter.agent.name}, a ${screenwriter.persona.role}.
Your style: ${screenwriter.persona.style}.
Your identity: ${screenwriter.persona.identity}.
Your focus areas: ${screenwriter.persona.focus}.

Core principles:
${(screenwriter.persona.core_principles || []).map((p, i) => `${i + 1}. ${p}`).join(' ')}

When to use you: ${screenwriter.agent.whentouse}
      `.trim());

      await repository.insert({
        name: screenwriter.agent.id,
        description: screenwriter.agent.title,
        capabilities: ['screenplay-writing', 'timing-precision', 'spec-compliance'],
        tone: 'precise',
        defaultProject: 'aismr',
        systemPrompt: screenwriterSystemPrompt,
        metadata: {
          v1Source: 'persona-screenwriter.json',
          role: screenwriter.persona.role,
          focus: screenwriter.persona.focus,
        },
      });

      console.log('    ✓ Screenwriter migrated');
    }

    console.log('✅ Persona migration complete');
  } catch (error) {
    console.error('❌ Persona migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migratePersonas();
