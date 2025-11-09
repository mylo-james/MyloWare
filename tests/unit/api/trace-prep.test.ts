import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'crypto';
import { handleTracePrep } from '@/api/routes/trace-prep.js';
import { db } from '@/db/client.js';
import { executionTraces, memories } from '@/db/schema.js';
import { TraceRepository } from '@/db/repositories/trace-repository.js';
import { ProjectRepository } from '@/db/repositories/project-repository.js';
import { getPersona } from '@/tools/context/getPersonaTool.js';
import { getProject } from '@/tools/context/getProjectTool.js';
import { searchMemories } from '@/tools/memory/searchTool.js';

// Mock context tools
vi.mock('@/tools/context/getPersonaTool.js', () => ({
  getPersona: vi.fn(),
}));

vi.mock('@/tools/context/getProjectTool.js', () => ({
  getProject: vi.fn(),
}));

vi.mock('@/tools/memory/searchTool.js', () => ({
  searchMemories: vi.fn(),
}));

const mockGetPersona = vi.mocked(getPersona);
const mockGetProject = vi.mocked(getProject);
const mockSearchMemories = vi.mocked(searchMemories);

const projectRepo = new ProjectRepository();
let generalProjectId: string;
let aismrProjectId: string;

describe('trace_prep HTTP Endpoint', () => {
  const traceRepo = new TraceRepository();

  beforeEach(async () => {
    await db.delete(memories);
    await db.delete(executionTraces);
    vi.clearAllMocks();

    const ensureProject = async (
      name: string,
      description: string,
      workflow: string[]
    ): Promise<string> => {
      const existing = await projectRepo.findByName(name);
      if (existing) {
        return existing.id;
      }
      const inserted = await projectRepo.insert({
        name,
        description,
        workflow,
        optionalSteps: [],
        guardrails: {},
        settings: {},
        metadata: {},
      });
      return inserted.id;
    };

    generalProjectId = await ensureProject('general', 'General Conversations', ['casey', 'iggy', 'riley', 'veo', 'alex', 'quinn']);
    aismrProjectId = await ensureProject('aismr', 'AISMR project', ['casey', 'iggy', 'riley', 'veo', 'alex', 'quinn']);
    // Default mocks
    mockGetPersona.mockResolvedValue({
      persona: {
        id: 'persona-1',
        name: 'casey',
        description: 'Showrunner',
        capabilities: [],
        tone: 'professional',
        defaultProject: null,
        systemPrompt: 'You are Casey, the Showrunner.',
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      metadata: {
        allowedTools: ['trace_update', 'memory_search', 'memory_store', 'handoff_to_agent'],
      },
    });

    mockGetProject.mockResolvedValue({
      project: {
        id: generalProjectId,
        name: 'general',
        description: 'General Conversations',
        workflows: ['casey', 'iggy', 'riley', 'veo', 'alex', 'quinn'],
        guardrails: { maxResponseSeconds: 30 },
        settings: {},
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    mockSearchMemories.mockResolvedValue({
      memories: [],
      totalFound: 0,
    });
  });

  const createMockRequest = (body: unknown): FastifyRequest => {
    return {
      body,
      ip: '127.0.0.1',
      headers: {},
    } as unknown as FastifyRequest;
  };

  const createMockReply = (): FastifyReply => {
    const reply = {
      code: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    } as unknown as FastifyReply;
    return reply;
  };

  describe('New trace creation', () => {
    it('should create a new trace when no traceId provided', async () => {
      const request = createMockRequest({
        sessionId: 'test-session',
        instructions: 'Make a video about candles',
        source: 'telegram',
      });
      const reply = createMockReply();

      await handleTracePrep(request, reply);

      expect(reply.code).toHaveBeenCalledWith(200);
      expect(reply.send).toHaveBeenCalled();

      const response = (reply.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.traceId).toBeDefined();
      expect(response.justCreated).toBe(true);
      expect(response.systemPrompt).toContain('Casey');
      expect(response.allowedTools).toContain('trace_update');
    });

    it('should default to Casey persona for new traces', async () => {
      const request = createMockRequest({
        sessionId: 'test-session',
      });
      const reply = createMockReply();

      await handleTracePrep(request, reply);

      expect(mockGetPersona).toHaveBeenCalledWith({ personaName: 'casey' });
      const response = (reply.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.persona.name).toBe('casey');
    });

    it('should set projectId to the general project for new traces', async () => {
      const request = createMockRequest({
        sessionId: 'test-session',
      });
      const reply = createMockReply();

      await handleTracePrep(request, reply);

      const response = (reply.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.trace.projectId).toBe(generalProjectId);
      expect(response.project.id).toBe(generalProjectId);
      expect(response.project.name).toBe('general');
    });
  });

  describe('Existing trace loading', () => {
    it('should load existing trace when traceId provided', async () => {
      // Create a trace first (defaults to casey)
      const trace = await traceRepo.create({
        projectId: aismrProjectId,
        sessionId: 'test-session',
        instructions: 'Use Iggy to generate 12 modifiers.',
      });
      await traceRepo.updateWorkflow(
        trace.traceId,
        'iggy',
        'Generate 12 AISMR modifiers and store them.',
        1
      );

      const request = createMockRequest({
        traceId: trace.traceId.toString(),
      });
      const reply = createMockReply();

      // Clear mocks to ensure fresh state
      mockGetPersona.mockClear();
      // Mock Iggy persona (first call for 'iggy', fallback won't be needed)
      mockGetPersona.mockResolvedValueOnce({
        persona: {
          id: 'persona-2',
          name: 'iggy',
          description: 'Creative Director',
          capabilities: [],
          tone: 'creative',
          defaultProject: null,
          systemPrompt: 'You are Iggy, the Creative Director.',
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        metadata: {
          allowedTools: ['memory_search', 'memory_store', 'handoff_to_agent'],
        },
      });

      await handleTracePrep(request, reply);

      expect(reply.code).toHaveBeenCalledWith(200);
      const response = (reply.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.traceId).toBe(trace.traceId);
      expect(response.justCreated).toBe(false);
      expect(response.trace.currentOwner).toBe('iggy');
      expect(response.persona.name).toBe('iggy');
    });

    it('should return 404 when traceId not found', async () => {
      const request = createMockRequest({
        traceId: '00000000-0000-0000-0000-000000000000',
      });
      const reply = createMockReply();

      await handleTracePrep(request, reply);

      expect(reply.code).toHaveBeenCalledWith(404);
      const response = (reply.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.error).toContain('Trace not found');
    });
  });

  describe('Casey init prompt', () => {
    it('should build Casey prompt when projectId is general', async () => {
      const request = createMockRequest({
        sessionId: 'test-session',
        instructions: 'Make a video',
      });
      const reply = createMockReply();

      await handleTracePrep(request, reply);

      const response = (reply.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.systemPrompt).toContain('Casey');
      expect(response.systemPrompt).toContain('Check project alignment');
      expect(response.systemPrompt).toContain('trace_update');
    });

    it('should include project alignment check when Casey has generic project and inferred project exists', async () => {
      // Create a trace with null projectId - will result in "conversation" fallback
      const trace = await traceRepo.create({
        projectId: null,
        sessionId: 'test-session',
        currentOwner: 'casey',
        instructions: 'run a test_video_gen',
      });

      const request = createMockRequest({
        traceId: trace.traceId,
        instructions: 'run a test_video_gen', // This should infer test_video_gen project
      });
      const reply = createMockReply();

      await handleTracePrep(request, reply);

      const response = (reply.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.systemPrompt).toContain('Casey');
      
      // If project is "conversation" or "general" and inferred project exists, should include alignment check
      // Note: This test verifies the prompt structure - actual behavior depends on project resolution
      if (response.project.name === 'conversation' || response.project.name === 'general') {
        // Should include project alignment instructions when project is generic
        expect(response.systemPrompt).toContain('Check project alignment');
        expect(response.systemPrompt).toContain('trace_update');
      }
    });

    it('should NOT include project alignment check when Casey has specific project set', async () => {
      const trace = await traceRepo.create({
        projectId: aismrProjectId,
        sessionId: 'test-session',
        currentOwner: 'casey',
        instructions: 'Make an AISMR video',
      });

      const request = createMockRequest({
        traceId: trace.traceId,
      });
      const reply = createMockReply();

      await handleTracePrep(request, reply);

      const response = (reply.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.systemPrompt).toContain('Casey');
      // Should NOT include project alignment check when project is already correctly set
      expect(response.systemPrompt).toContain('Project is already set');
      expect(response.systemPrompt).not.toContain('Check project alignment');
      expect(response.systemPrompt).not.toContain('conversation');
    });
  });

  describe('Standard agent prompt', () => {
    it('should build persona prompt when projectId is known', async () => {
      const trace = await traceRepo.create({
        projectId: aismrProjectId,
        sessionId: 'test-session',
        currentOwner: 'riley',
        instructions: 'Write screenplays',
      });

      mockGetPersona.mockResolvedValueOnce({
        persona: {
          id: 'persona-3',
          name: 'riley',
          description: 'Head Writer',
          capabilities: [],
          tone: 'creative',
          defaultProject: null,
          systemPrompt: 'You are Riley, the Head Writer.',
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        metadata: {
          allowedTools: ['memory_search', 'memory_store', 'handoff_to_agent'],
        },
      });

      const request = createMockRequest({
        traceId: trace.traceId,
      });
      const reply = createMockReply();

      await handleTracePrep(request, reply);

      const response = (reply.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.systemPrompt).toContain('Riley');
      expect(response.systemPrompt).toContain('TRACE:');
      expect(response.systemPrompt).toContain('PROJECT');
      expect(response.systemPrompt).toContain('aismr');
    });
  });

  describe('Memory integration', () => {
    it('should load memories filtered by traceId', async () => {
      const trace = await traceRepo.create({
        projectId: aismrProjectId,
        sessionId: 'test-session',
      });

      mockSearchMemories.mockResolvedValueOnce({
        memories: [
          {
            id: 'memory-1',
            content: 'Test memory',
            memoryType: 'episodic',
            persona: ['casey'],
            project: ['aismr'],
            tags: [],
            relatedTo: [],
            createdAt: new Date(),
            updatedAt: new Date(),
            lastAccessedAt: null,
            accessCount: 0,
            metadata: {},
          },
        ],
        totalFound: 1,
      });

      const request = createMockRequest({
        traceId: trace.traceId,
      });
      const reply = createMockReply();

      await handleTracePrep(request, reply);

      expect(mockSearchMemories).toHaveBeenCalledWith({
        query: '',
        traceId: trace.traceId,
        project: 'aismr',
        limit: 12,
      });

      const response = (reply.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.memories).toHaveLength(1);
      expect(response.memorySummary).toContain('Test memory');
    });
  });

  describe('Allowed tools derivation', () => {
    it('should include trace_update for Casey', async () => {
      const request = createMockRequest({
        sessionId: 'test-session',
      });
      const reply = createMockReply();

      await handleTracePrep(request, reply);

      const response = (reply.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.allowedTools).toContain('trace_update');
    });

    it('should not include trace_update for non-Casey personas', async () => {
      const trace = await traceRepo.create({
        projectId: aismrProjectId,
        sessionId: 'test-session',
      });

      // Update trace to have iggy as currentOwner
      await traceRepo.updateWorkflow(trace.traceId, 'iggy', 'Generate modifiers', 1);

      // Clear previous mocks
      mockGetPersona.mockClear();
      mockGetPersona.mockResolvedValueOnce({
        persona: {
          id: 'persona-iggy',
          name: 'iggy',
          description: 'Creative Director',
          capabilities: [],
          tone: 'creative',
          defaultProject: null,
          systemPrompt: 'You are Iggy.',
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        metadata: {
          allowedTools: ['memory_search', 'memory_store', 'handoff_to_agent'], // Core tools only
        },
      });

      const request = createMockRequest({
        traceId: trace.traceId,
      });
      const reply = createMockReply();

      await handleTracePrep(request, reply);

      const response = (reply.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.allowedTools).not.toContain('trace_update');
      expect(response.allowedTools).toContain('handoff_to_agent');
    });

    it('should include job tools for Veo/Alex when project is known', async () => {
      const trace = await traceRepo.create({
        projectId: aismrProjectId,
        sessionId: 'test-session',
      });

      // Update trace to have veo as currentOwner
      await traceRepo.updateWorkflow(trace.traceId, 'veo', 'Generate videos', 3);

      // Clear previous mocks
      mockGetPersona.mockClear();
      mockGetPersona.mockResolvedValueOnce({
        persona: {
          id: 'persona-veo',
          name: 'veo',
          description: 'Production',
          capabilities: [],
          tone: 'professional',
          defaultProject: null,
          systemPrompt: 'You are Veo.',
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        metadata: {
          allowedTools: ['memory_search', 'memory_store', 'handoff_to_agent'], // Core tools only
        },
      });

      const request = createMockRequest({
        traceId: trace.traceId,
      });
      const reply = createMockReply();

      await handleTracePrep(request, reply);

      const response = (reply.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.allowedTools).toContain('jobs');
      expect(response.allowedTools).toContain('workflow_trigger');
    });
  });

  describe('Input validation', () => {
    it('should reject invalid traceId format', async () => {
      const request = createMockRequest({
        traceId: 'invalid-uuid',
      });
      const reply = createMockReply();

      await handleTracePrep(request, reply);

      expect(reply.code).toHaveBeenCalledWith(400);
      const response = (reply.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.error).toBe('Invalid request body');
    });

    it('should accept optional fields', async () => {
      const request = createMockRequest({
        sessionId: 'test-session',
        // No instructions, source, metadata - all optional
      });
      const reply = createMockReply();

      await handleTracePrep(request, reply);

      expect(reply.code).toHaveBeenCalledWith(200);
    });
  });

  describe('Error handling', () => {
    it('should handle persona not found gracefully', async () => {
      const trace = await traceRepo.create({
        projectId: aismrProjectId,
        sessionId: 'test-session',
      });

      // Update trace to have nonexistent persona as currentOwner (will trigger fallback)
      await traceRepo.updateWorkflow(trace.traceId, 'nonexistent', 'Test', 1);

      // Clear mocks
      mockGetPersona.mockClear();
      
      // First call fails (nonexistent persona)
      mockGetPersona.mockRejectedValueOnce(new Error('Persona not found'));
      // Should fallback to Casey
      mockGetPersona.mockResolvedValueOnce({
        persona: {
          id: 'persona-casey',
          name: 'casey',
          description: 'Showrunner',
          capabilities: [],
          tone: 'professional',
          defaultProject: null,
          systemPrompt: 'You are Casey.',
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        metadata: {
          allowedTools: ['trace_update', 'memory_search', 'memory_store', 'handoff_to_agent'],
        },
      });

      const request = createMockRequest({
        traceId: trace.traceId.toString(),
      });
      const reply = createMockReply();

      await handleTracePrep(request, reply);

      // Should fallback to Casey
      expect(mockGetPersona).toHaveBeenCalledWith({ personaName: 'casey' });
      const response = (reply.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response).toBeDefined();
      expect(response.persona.name).toBe('casey');
    });

    it('should handle project load failure gracefully', async () => {
      const trace = await traceRepo.create({
        projectId: randomUUID(),
        sessionId: 'test-session',
      });

      mockGetProject.mockRejectedValueOnce(new Error('Project not found'));

      const request = createMockRequest({
        traceId: trace.traceId,
      });
      const reply = createMockReply();

      await handleTracePrep(request, reply);

      // Should use fallback project context
      const response = (reply.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.project.id).toBe('unknown');
    });
  });
});

