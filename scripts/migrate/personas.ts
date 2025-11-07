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
        allowedTools: ['memory_search', 'memory_store', 'handoff_to_agent'],
        metadata: {
          v1Source: 'persona-chat.json',
          role: chat.persona.role,
          focus: chat.persona.focus,
        },
      });

      console.log('    ✓ Chat persona migrated');
    }

    // Migrate Casey (Showrunner)
    console.log('  - Migrating Casey (Showrunner)...');
    const caseyJson = await readFile(path.join(dataDir, 'casey.json'), 'utf-8');
    const caseyDoc: any = JSON.parse(caseyJson);
    const existingCasey = await repository.findByName('casey');
    if (existingCasey) {
      console.log('    ⏭️  Casey persona already exists, skipping');
    } else {
      const caseySystemPrompt = cleanForAI(
        `${caseyDoc.activation_notice}\n\n${caseyDoc.critical_notice}\n\n` +
          'Follow MCP tool order: context_get_project → context_get_persona("iggy") → trace_create → memory_store → handoff_to_agent. ' +
          'Always tag memories with traceId and persona. After handoff to Iggy, go idle and wait for Quinn to signal completion.'
      );

      await repository.insert({
        name: 'casey',
        description: caseyDoc.title || 'Showrunner',
        capabilities: ['coordination', 'trace-create', 'handoff'],
        tone: 'confident',
        defaultProject: 'aismr',
        systemPrompt: caseySystemPrompt,
        allowedTools: ['set_project', 'memory_search', 'memory_store', 'handoff_to_agent'],
        metadata: { v1Source: 'casey.json', role: 'showrunner' },
      });

      console.log('    ✓ Casey persona migrated');
    }

    // Migrate Idea Generator
    console.log('  - Migrating Idea Generator...');
    const iggyJson = await readFile(path.join(dataDir, 'ideagenerator.json'), 'utf-8');
    const iggy: V1Persona = JSON.parse(iggyJson);

    const existingIggyId = await repository.findByName(iggy.agent.id);
    if (existingIggyId) {
      console.log('    ⏭️  Idea Generator already exists (ideagenerator), skipping');
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
        allowedTools: ['memory_search', 'memory_store', 'handoff_to_agent'],
        metadata: {
          v1Source: 'persona-ideagenerator.json',
          role: iggy.persona.role,
          focus: iggy.persona.focus,
        },
      });

      console.log('    ✓ Idea Generator migrated');
    }

    // Alias: Iggy persona (Creative Director) using Idea Generator content
    console.log('  - Ensuring Iggy (Creative Director) exists...');
    const existingIggyPersona = await repository.findByName('iggy');
    if (existingIggyPersona) {
      console.log('    ⏭️  Iggy persona already exists, skipping');
    } else {
      const iggySystemPrompt2 = cleanForAI(`
You are Iggy, the Creative Director for AISMR. Generate 12 unique, on-brand modifiers per object.\n
Use memory_search to ensure session + archive uniqueness before committing. Store results with traceId, then hand off to Riley.\n
Seek HITL approval via Telegram before handoff. Always tag memories with persona=['iggy'] and project=['aismr'].`);
      await repository.insert({
        name: 'iggy',
        description: 'Creative Director',
        capabilities: ['idea-generation', 'uniqueness-verification', 'handoff'],
        tone: 'creative',
        defaultProject: 'aismr',
        systemPrompt: iggySystemPrompt2,
        allowedTools: ['memory_search', 'memory_store', 'handoff_to_agent'],
        metadata: { aliasOf: 'ideagenerator' },
      });
      console.log('    ✓ Iggy persona created');
    }

    // Migrate Screenwriter
    console.log('  - Migrating Screenwriter...');
    const screenwriterJson = await readFile(path.join(dataDir, 'screenwriter.json'), 'utf-8');
    const screenwriter: V1Persona = JSON.parse(screenwriterJson);

    const existingScreenwriter = await repository.findByName(screenwriter.agent.id);
    if (existingScreenwriter) {
      console.log('    ⏭️  Screenwriter already exists (screenwriter), skipping');
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
        allowedTools: ['memory_search', 'memory_store', 'handoff_to_agent'],
        metadata: {
          v1Source: 'persona-screenwriter.json',
          role: screenwriter.persona.role,
          focus: screenwriter.persona.focus,
        },
      });

      console.log('    ✓ Screenwriter migrated');
    }

    // Alias: Riley persona (Head Writer) using Screenwriter content
    console.log('  - Ensuring Riley (Head Writer) exists...');
    const existingRiley = await repository.findByName('riley');
    if (existingRiley) {
      console.log('    ⏭️  Riley persona already exists, skipping');
    } else {
      const rileySystemPrompt = cleanForAI(`
You are Riley, Head Writer. Retrieve Iggy's approved modifiers by traceId, write 12 AISMR screenplays (8.0s each, whisper at 3.0s, ≤2 hands, no music), store them with traceId, then hand off to Veo.`);
      await repository.insert({
        name: 'riley',
        description: 'Head Writer',
        capabilities: ['screenplay-writing', 'timing-precision', 'spec-compliance'],
        tone: 'precise',
        defaultProject: 'aismr',
        systemPrompt: rileySystemPrompt,
        allowedTools: ['memory_search', 'memory_store', 'handoff_to_agent'],
        metadata: { aliasOf: 'screenwriter' },
      });
      console.log('    ✓ Riley persona created');
    }

    // Create remaining production personas: Veo, Alex, Quinn
    console.log('  - Ensuring Veo (Production) exists...');
    const existingVeo = await repository.findByName('veo');
    if (!existingVeo) {
      const veoPrompt = cleanForAI(
        'You are Veo, Production. Load scripts by traceId, call external video APIs to generate videos, store URLs with traceId, then hand off to Alex.'
      );
      await repository.insert({
        name: 'veo',
        description: 'Production (Video Generation)',
        capabilities: ['video-generation', 'batch-processing', 'handoff'],
        tone: 'efficient',
        defaultProject: 'aismr',
        systemPrompt: veoPrompt,
        allowedTools: ['memory_search', 'memory_store', 'handoff_to_agent', 'job_upsert', 'jobs_summary'],
        metadata: {},
      });
      console.log('    ✓ Veo persona created');
    } else {
      console.log('    ⏭️  Veo persona already exists, skipping');
    }

    console.log('  - Ensuring Alex (Editor) exists...');
    const existingAlex = await repository.findByName('alex');
    if (!existingAlex) {
      const alexPrompt = cleanForAI(
        'You are Alex, Editor. Retrieve videos by traceId, stitch the compilation, request HITL approval via Telegram, store the final URL with traceId, then hand off to Quinn.'
      );
      await repository.insert({
        name: 'alex',
        description: 'Editor (Post-Production)',
        capabilities: ['editing', 'compilation', 'handoff'],
        tone: 'meticulous',
        defaultProject: 'aismr',
        systemPrompt: alexPrompt,
        allowedTools: ['memory_search', 'memory_store', 'handoff_to_agent', 'job_upsert', 'jobs_summary'],
        metadata: {},
      });
      console.log('    ✓ Alex persona created');
    } else {
      console.log('    ⏭️  Alex persona already exists, skipping');
    }

    console.log('  - Ensuring Quinn (Publisher) exists...');
    const existingQuinn = await repository.findByName('quinn');
    if (!existingQuinn) {
      const quinnPrompt = cleanForAI(
        'You are Quinn, Publisher. Retrieve the final edit by traceId, publish to platforms (TikTok/YouTube), store platform URLs with traceId, and call workflow_complete with outputs.'
      );
      await repository.insert({
        name: 'quinn',
        description: 'Social Media Manager',
        capabilities: ['publishing', 'captioning', 'workflow-complete'],
        tone: 'upbeat',
        defaultProject: 'aismr',
        systemPrompt: quinnPrompt,
        allowedTools: ['memory_search', 'memory_store', 'handoff_to_agent', 'workflow_complete'],
        metadata: {},
      });
      console.log('    ✓ Quinn persona created');
    } else {
      console.log('    ⏭️  Quinn persona already exists, skipping');
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
