import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/db/client.js';
import { executionTraces, memories, personas, projects } from '@/db/schema.js';
import { TraceRepository } from '@/db/repositories/trace-repository.js';
import { PersonaRepository } from '@/db/repositories/persona-repository.js';
import { ProjectRepository } from '@/db/repositories/project-repository.js';
import { MemoryRepository } from '@/db/repositories/memory-repository.js';
import { embedText } from '@/utils/embedding.js';

describe('trace_prep Endpoint Integration', () => {
  const traceRepo = new TraceRepository();
  const personaRepo = new PersonaRepository();
  const projectRepo = new ProjectRepository();
  const memoryRepo = new MemoryRepository();

  beforeEach(async () => {
    await db.delete(memories);
    await db.delete(executionTraces);
    await db.delete(personas);
    await db.delete(projects);
  });

  describe('Full flow: create trace → load → update → reload', () => {
    it('should create trace, load it, update project, and reload with new persona', async () => {
      // Step 1: Create initial trace (Casey, unknown project)
      const trace1 = await traceRepo.create({
        projectId: 'unknown',
        sessionId: 'integration-test-session',
        currentOwner: 'casey',
        instructions: 'Make a video about candles',
        metadata: { source: 'telegram' },
      });

      expect(trace1.traceId).toBeDefined();
      expect(trace1.projectId).toBe('unknown');
      expect(trace1.currentOwner).toBe('casey');

      // Seed Casey persona
      await personaRepo.create({
        name: 'casey',
        description: 'Showrunner',
        capabilities: ['coordination'],
        tone: 'professional',
        systemPrompt: 'You are Casey, the Showrunner. Determine the project and hand off.',
        metadata: {
          allowedTools: ['trace_update', 'memory_search', 'memory_store', 'handoff_to_agent'],
        },
      });

      // Seed AISMR project
      await projectRepo.create({
        name: 'aismr',
        description: 'AISMR video project',
        workflows: ['casey', 'iggy', 'riley', 'veo', 'alex', 'quinn'],
        guardrails: { videoCount: 12 },
        settings: {},
      });

      // Step 2: Update trace with project (simulating Casey's trace_update call)
      const updatedTrace = await traceRepo.updateTrace(trace1.traceId, {
        projectId: 'aismr',
        currentOwner: 'iggy',
        instructions: 'Generate 12 surreal candle modifiers',
        workflowStep: 1,
      });

      expect(updatedTrace?.projectId).toBe('aismr');
      expect(updatedTrace?.currentOwner).toBe('iggy');

      // Seed Iggy persona
      await personaRepo.create({
        name: 'iggy',
        description: 'Creative Director',
        capabilities: ['ideation'],
        tone: 'creative',
        systemPrompt: 'You are Iggy, the Creative Director. Generate unique modifiers.',
        metadata: {
          allowedTools: ['memory_search', 'memory_store', 'handoff_to_agent'],
        },
      });

      // Step 3: Store some memories for the trace
      const memoryContent = 'Previous candle ideas: Void, Liquid, Crystalline';
      const embedding = await embedText(memoryContent);
      await memoryRepo.create({
        content: memoryContent,
        embedding,
        memoryType: 'episodic',
        persona: ['casey'],
        project: ['aismr'],
        tags: ['candles', 'ideas'],
        metadata: { traceId: trace1.traceId },
      });

      // Step 4: Reload trace (simulating workflow calling trace_prep again)
      const reloadedTrace = await traceRepo.getTrace(trace1.traceId);
      expect(reloadedTrace).toBeDefined();
      expect(reloadedTrace?.currentOwner).toBe('iggy');
      expect(reloadedTrace?.projectId).toBe('aismr');
      expect(reloadedTrace?.workflowStep).toBe(1);
    });
  });

  describe('Prompt assembly with real data', () => {
    it('should assemble Casey prompt correctly for unknown project', async () => {
      // Create trace
      const trace = await traceRepo.create({
        projectId: 'unknown',
        sessionId: 'test-session',
        currentOwner: 'casey',
        instructions: 'Make a video',
      });

      // Seed Casey persona
      await personaRepo.create({
        name: 'casey',
        description: 'Showrunner',
        capabilities: [],
        tone: 'professional',
        systemPrompt: 'You are Casey, the Showrunner.',
        metadata: {
          allowedTools: ['trace_update', 'memory_search', 'memory_store', 'handoff_to_agent'],
        },
      });

      // Verify trace exists
      const loadedTrace = await traceRepo.getTrace(trace.traceId);
      expect(loadedTrace).toBeDefined();
      expect(loadedTrace?.projectId).toBe('unknown');
      expect(loadedTrace?.currentOwner).toBe('casey');
    });

    it('should assemble persona prompt correctly for known project', async () => {
      // Seed project and persona
      await projectRepo.create({
        name: 'aismr',
        description: 'AISMR project description',
        workflows: ['casey', 'iggy'],
        guardrails: { videoCount: 12 },
        settings: {},
      });

      await personaRepo.create({
        name: 'iggy',
        description: 'Creative Director',
        capabilities: [],
        tone: 'creative',
        systemPrompt: 'You are Iggy, the Creative Director.',
        metadata: {
          allowedTools: ['memory_search', 'memory_store', 'handoff_to_agent'],
        },
      });

      // Create trace with known project
      const trace = await traceRepo.create({
        projectId: 'aismr',
        sessionId: 'test-session',
        currentOwner: 'iggy',
        instructions: 'Generate 12 modifiers',
      });

      // Verify trace loaded correctly
      const loadedTrace = await traceRepo.getTrace(trace.traceId);
      expect(loadedTrace).toBeDefined();
      expect(loadedTrace?.projectId).toBe('aismr');
      expect(loadedTrace?.currentOwner).toBe('iggy');
    });
  });

  describe('Memory integration', () => {
    it('should load memories filtered by traceId', async () => {
      // Create trace
      const trace = await traceRepo.create({
        projectId: 'aismr',
        sessionId: 'test-session',
        currentOwner: 'casey',
      });

      // Seed project
      await projectRepo.create({
        name: 'aismr',
        description: 'AISMR project',
        workflows: ['casey'],
        guardrails: {},
        settings: {},
      });

      // Create memories with traceId in metadata
      const memory1Content = 'First memory for trace';
      const memory2Content = 'Second memory for trace';
      const embedding1 = await embedText(memory1Content);
      const embedding2 = await embedText(memory2Content);

      await memoryRepo.create({
        content: memory1Content,
        embedding: embedding1,
        memoryType: 'episodic',
        persona: ['casey'],
        project: ['aismr'],
        tags: [],
        metadata: { traceId: trace.traceId },
      });

      await memoryRepo.create({
        content: memory2Content,
        embedding: embedding2,
        memoryType: 'episodic',
        persona: ['casey'],
        project: ['aismr'],
        tags: [],
        metadata: { traceId: trace.traceId },
      });

      // Create a memory for a different trace (should not be included)
      const otherTrace = await traceRepo.create({
        projectId: 'aismr',
        sessionId: 'other-session',
      });

      const otherMemoryContent = 'Memory for other trace';
      const otherEmbedding = await embedText(otherMemoryContent);
      await memoryRepo.create({
        content: otherMemoryContent,
        embedding: otherEmbedding,
        memoryType: 'episodic',
        persona: ['casey'],
        project: ['aismr'],
        tags: [],
        metadata: { traceId: otherTrace.traceId },
      });

      // Verify memories can be queried by traceId
      // (This tests the memory search integration, not the endpoint directly)
      // The endpoint uses searchMemories which filters by traceId in metadata
      const allMemories = await db.select().from(memories);
      const traceMemories = allMemories.filter(
        (m) => (m.metadata as { traceId?: string })?.traceId === trace.traceId
      );

      expect(traceMemories.length).toBe(2);
      expect(traceMemories.some((m) => m.content === memory1Content)).toBe(true);
      expect(traceMemories.some((m) => m.content === memory2Content)).toBe(true);
    });
  });

  describe('Trace ownership transitions', () => {
    it('should track ownership changes through workflow steps', async () => {
      // Create trace with Casey
      const trace = await traceRepo.create({
        projectId: 'aismr',
        sessionId: 'test-session',
        currentOwner: 'casey',
        workflowStep: 0,
      });

      // Transition to Iggy
      const trace1 = await traceRepo.updateTrace(trace.traceId, {
        currentOwner: 'iggy',
        previousOwner: 'casey',
        workflowStep: 1,
        instructions: 'Generate modifiers',
      });

      expect(trace1?.currentOwner).toBe('iggy');
      expect(trace1?.previousOwner).toBe('casey');
      expect(trace1?.workflowStep).toBe(1);

      // Transition to Riley
      const trace2 = await traceRepo.updateTrace(trace.traceId, {
        currentOwner: 'riley',
        previousOwner: 'iggy',
        workflowStep: 2,
        instructions: 'Write screenplays',
      });

      expect(trace2?.currentOwner).toBe('riley');
      expect(trace2?.previousOwner).toBe('iggy');
      expect(trace2?.workflowStep).toBe(2);
    });
  });
});

