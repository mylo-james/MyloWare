import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { handleTracePrep } from '@/api/routes/trace-prep.js';
import { db } from '@/db/client.js';
import { executionTraces, memories, personas, projects } from '@/db/schema.js';
import { TraceRepository } from '@/db/repositories/trace-repository.js';
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

describe('trace_prep HTTP Endpoint', () => {
  const traceRepo = new TraceRepository();

  beforeEach(async () => {
    await db.delete(memories);
    await db.delete(executionTraces);
    vi.clearAllMocks();

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
        id: 'project-1',
        name: 'aismr',
        description: 'AISMR project',
        workflows: ['casey', 'iggy', 'riley'],
        guardrails: { test: 'guardrails' },
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
      expect(response.allowedTools).toContain('set_project');
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

    it('should set projectId to "unknown" for new traces', async () => {
      const request = createMockRequest({
        sessionId: 'test-session',
      });
      const reply = createMockReply();

      await handleTracePrep(request, reply);

      const response = (reply.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.trace.projectId).toBe('unknown');
      expect(response.project.id).toBe('unknown');
    });
  });

  describe('Existing trace loading', () => {
    it('should load existing trace when traceId provided', async () => {
      // Create a trace first (defaults to casey)
      const trace = await traceRepo.create({
        projectId: 'aismr',
        sessionId: 'test-session',
        instructions: 'Generate 12 modifiers',
      });

      // Update trace to have iggy as currentOwner (simulating handoff)
      await traceRepo.updateWorkflow(trace.traceId, 'iggy', 'Generate 12 modifiers', 1);

      const request = createMockRequest({
        traceId: trace.traceId.toString(), // Ensure it's a string UUID
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
    it('should build Casey prompt when projectId is unknown', async () => {
      const request = createMockRequest({
        sessionId: 'test-session',
        instructions: 'Make a video',
      });
      const reply = createMockReply();

      await handleTracePrep(request, reply);

      const response = (reply.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.systemPrompt).toContain('Casey');
      expect(response.systemPrompt).toContain('Determine which project');
      expect(response.systemPrompt).toContain('set_project');
    });
  });

  describe('Standard agent prompt', () => {
    it('should build persona prompt when projectId is known', async () => {
      const trace = await traceRepo.create({
        projectId: 'aismr',
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
        projectId: 'aismr',
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
        query: '', // Required by type but not used when traceId is provided
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
    it('should include set_project for Casey', async () => {
      const request = createMockRequest({
        sessionId: 'test-session',
      });
      const reply = createMockReply();

      await handleTracePrep(request, reply);

      const response = (reply.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.allowedTools).toContain('set_project');
    });

    it('should not include set_project for non-Casey personas', async () => {
      const trace = await traceRepo.create({
        projectId: 'aismr',
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
          allowedTools: ['memory_search', 'memory_store', 'handoff_to_agent'], // No set_project
        },
      });

      const request = createMockRequest({
        traceId: trace.traceId,
      });
      const reply = createMockReply();

      await handleTracePrep(request, reply);

      const response = (reply.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.allowedTools).not.toContain('set_project');
      expect(response.allowedTools).toContain('handoff_to_agent');
    });

    it('should include job tools for Veo/Alex when project is known', async () => {
      const trace = await traceRepo.create({
        projectId: 'aismr',
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
          allowedTools: ['memory_search', 'memory_store', 'handoff_to_agent'], // No set_project
        },
      });

      const request = createMockRequest({
        traceId: trace.traceId,
      });
      const reply = createMockReply();

      await handleTracePrep(request, reply);

      const response = (reply.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.allowedTools).toContain('job_upsert');
      expect(response.allowedTools).toContain('jobs_summary');
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
        projectId: 'aismr',
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
          allowedTools: ['set_project', 'memory_search', 'memory_store', 'handoff_to_agent'],
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
        projectId: 'nonexistent-project',
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

