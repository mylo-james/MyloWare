import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { registerApiRoutes } from '../../server/routes/api';
import { registerWorkflowRunRoutes } from '../../server/routes/workflow-runs';
import { WorkflowRunRepository } from '../../db/operations/workflowRunRepository';
import { WorkflowExecutor } from '../../workflow/WorkflowExecutor';
import { ExecutionContextBuilder } from '../../workflow/ExecutionContext';

/**
 * Multi-Project Integration Tests
 *
 * Verifies that:
 * - Different projects can have isolated workflows
 * - Project-specific configurations load correctly
 * - Workflow isolation prevents cross-project interference
 * - Generic workflows adapt to project configs
 *
 * Note: Requires test database with ingested workflows.
 */
describe('Multi-Project Integration', () => {
  let app: FastifyInstance;
  let workflowRunRepo: WorkflowRunRepository;

  beforeEach(async () => {
    if (!process.env.TEST_DATABASE_URL && !process.env.OPERATIONS_DATABASE_URL) {
      return;
    }

    app = fastify({ logger: false });
    workflowRunRepo = new WorkflowRunRepository();

    await registerApiRoutes(app);
    await registerWorkflowRunRoutes(app);
    await app.ready();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it('should create isolated workflow runs for different projects', async () => {
    if (!process.env.TEST_DATABASE_URL && !process.env.OPERATIONS_DATABASE_URL) {
      return;
    }

    const aismrSessionId = randomUUID();
    const youtubeSessionId = randomUUID();

    // Create AISMR workflow run
    const aismrResponse = await app.inject({
      method: 'POST',
      url: '/api/workflow-runs',
      payload: {
        projectId: 'aismr',
        sessionId: aismrSessionId,
        input: { userInput: 'Create ASMR video about puppies' },
      },
    });

    expect(aismrResponse.statusCode).toBe(201);
    const aismrRun = aismrResponse.json().workflowRun;
    expect(aismrRun.projectId).toBe('aismr');

    // Create YouTube Shorts workflow run
    const youtubeResponse = await app.inject({
      method: 'POST',
      url: '/api/workflow-runs',
      payload: {
        projectId: 'youtube-shorts',
        sessionId: youtubeSessionId,
        input: { userInput: 'Create YouTube Short about productivity' },
      },
    });

    expect(youtubeResponse.statusCode).toBe(201);
    const youtubeRun = youtubeResponse.json().workflowRun;
    expect(youtubeRun.projectId).toBe('youtube-shorts');

    // Verify isolation - runs should have different IDs
    expect(aismrRun.id).not.toBe(youtubeRun.id);

    // Verify each run can be retrieved independently
    const getAismrResponse = await app.inject({
      method: 'GET',
      url: `/api/workflow-runs/${aismrRun.id}`,
    });

    expect(getAismrResponse.statusCode).toBe(200);
    expect(getAismrResponse.json().workflowRun.projectId).toBe('aismr');

    const getYoutubeResponse = await app.inject({
      method: 'GET',
      url: `/api/workflow-runs/${youtubeRun.id}`,
    });

    expect(getYoutubeResponse.statusCode).toBe(200);
    expect(getYoutubeResponse.json().workflowRun.projectId).toBe('youtube-shorts');
  });

  it('should load project-specific workflow definitions', async () => {
    if (!process.env.TEST_DATABASE_URL && !process.env.OPERATIONS_DATABASE_URL) {
      return;
    }

    // Create execution contexts for different projects
    const aismrContext = ExecutionContextBuilder.create(
      randomUUID(),
      randomUUID(),
      'aismr',
      'test input',
    );

    const youtubeContext = ExecutionContextBuilder.create(
      randomUUID(),
      randomUUID(),
      'youtube-shorts',
      'test input',
    );

    const aismrExecutor = new WorkflowExecutor(aismrContext);
    const youtubeExecutor = new WorkflowExecutor(youtubeContext);

    // Mock RAG results (in production, these come from prompts.search)
    const aismrWorkflowDef = {
      title: 'AISMR Idea Generation Workflow',
      memoryType: 'procedural' as const,
      project: ['aismr'],
      workflow: {
        name: 'Generate Ideas',
        description: 'AISMR-specific workflow',
        steps: [
          {
            id: 'step1',
            step: 1,
            type: 'mcp_call' as const,
            mcp_call: {
              tool: 'prompts.search',
              params: { project: 'aismr', query: 'test' },
            },
          },
        ],
      },
    };

    const youtubeWorkflowDef = {
      title: 'YouTube Shorts Idea Generation Workflow',
      memoryType: 'procedural' as const,
      project: ['youtube-shorts'],
      workflow: {
        name: 'Generate Shorts Ideas',
        description: 'YouTube-specific workflow',
        steps: [
          {
            id: 'step1',
            step: 1,
            type: 'mcp_call' as const,
            mcp_call: {
              tool: 'prompts.search',
              params: { project: 'youtube-shorts', query: 'test' },
            },
          },
        ],
      },
    };

    // Load workflows
    aismrExecutor.loadWorkflow(aismrWorkflowDef);
    youtubeExecutor.loadWorkflow(youtubeWorkflowDef);

    // Verify each executor has correct workflow
    const aismrWorkflow = aismrExecutor.getWorkflow();
    const youtubeWorkflow = youtubeExecutor.getWorkflow();

    expect(aismrWorkflow?.project).toContain('aismr');
    expect(youtubeWorkflow?.project).toContain('youtube-shorts');
    expect(aismrWorkflow?.title).toContain('AISMR');
    expect(youtubeWorkflow?.title).toContain('YouTube');
  });

  it('should resolve project-specific variables correctly', async () => {
    if (!process.env.TEST_DATABASE_URL && !process.env.OPERATIONS_DATABASE_URL) {
      return;
    }

    const aismrContext = ExecutionContextBuilder.create(
      'aismr-run-id',
      'aismr-session-id',
      'aismr',
      'Create ASMR video',
    );

    const executor = new WorkflowExecutor(aismrContext);

    // Test variable resolution
    const resolved = executor.resolveVariables('Project: ${context.projectId}, Input: ${context.userInput}');
    expect(resolved).toBe('Project: aismr, Input: Create ASMR video');

    const params = executor.resolveParams({
      query: '${context.userInput}',
      project: '${context.projectId}',
      sessionId: '${context.sessionId}',
    });

    expect(params.query).toBe('Create ASMR video');
    expect(params.project).toBe('aismr');
    expect(params.sessionId).toBe('aismr-session-id');
  });

  it('should maintain stage isolation across projects', async () => {
    if (!process.env.TEST_DATABASE_URL && !process.env.OPERATIONS_DATABASE_URL) {
      return;
    }

    const aismrRunId = randomUUID();
    const youtubeRunId = randomUUID();

    // Create runs for both projects
    await app.inject({
      method: 'POST',
      url: '/api/workflow-runs',
      payload: {
        id: aismrRunId,
        projectId: 'aismr',
        sessionId: randomUUID(),
        input: { userInput: 'test' },
      },
    });

    await app.inject({
      method: 'POST',
      url: '/api/workflow-runs',
      payload: {
        id: youtubeRunId,
        projectId: 'youtube-shorts',
        sessionId: randomUUID(),
        input: { userInput: 'test' },
      },
    });

    // Update AISMR run stage
    await app.inject({
      method: 'PATCH',
      url: `/api/workflow-runs/${aismrRunId}`,
      payload: {
        currentStage: 'screenplay',
        stages: {
          idea_generation: { status: 'completed', output: { ideas: [] } },
          screenplay: { status: 'running' },
          video_generation: { status: 'pending' },
          publishing: { status: 'pending' },
        },
      },
    });

    // Verify YouTube run is unaffected
    const youtubeResponse = await app.inject({
      method: 'GET',
      url: `/api/workflow-runs/${youtubeRunId}`,
    });

    const youtubeRun = youtubeResponse.json().workflowRun;
    expect(youtubeRun.currentStage).toBe('idea_generation');
    expect(youtubeRun.projectId).toBe('youtube-shorts');
  });

  it('should handle different project configurations', async () => {
    if (!process.env.TEST_DATABASE_URL && !process.env.OPERATIONS_DATABASE_URL) {
      return;
    }

    const { WorkflowStateManager } = await import('../../workflow/WorkflowStateManager.js');
    const stateManager = new WorkflowStateManager();

    const aismrRunId = randomUUID();
    const youtubeRunId = randomUUID();

    // Create runs
    await app.inject({
      method: 'POST',
      url: '/api/workflow-runs',
      payload: {
        id: aismrRunId,
        projectId: 'aismr',
        sessionId: randomUUID(),
        input: { userInput: 'test' },
      },
    });

    await app.inject({
      method: 'POST',
      url: '/api/workflow-runs',
      payload: {
        id: youtubeRunId,
        projectId: 'youtube-shorts',
        sessionId: randomUUID(),
        input: { userInput: 'test' },
      },
    });

    // Set different stage outputs
    await stateManager.setStageOutput(aismrRunId, 'idea_generation', {
      ideas: [{ idea: 'ASMR Idea', vibe: 'Relaxing' }],
    });

    await stateManager.setStageOutput(youtubeRunId, 'idea_generation', {
      ideas: [{ title: 'YouTube Short Idea', hook: 'Attention-grabbing' }],
    });

    // Verify outputs are isolated and correct
    const aismrOutput = await stateManager.getStageOutput(aismrRunId, 'idea_generation');
    const youtubeOutput = await stateManager.getStageOutput(youtubeRunId, 'idea_generation');

    expect(aismrOutput).toBeDefined();
    expect(youtubeOutput).toBeDefined();
    expect(aismrOutput).not.toEqual(youtubeOutput);

    // AISMR output should have 'idea' and 'vibe'
    if (aismrOutput && typeof aismrOutput === 'object') {
      const output = aismrOutput as { ideas?: Array<{ idea?: unknown; vibe?: unknown }> };
      expect(output.ideas?.[0]?.idea).toBeDefined();
      expect(output.ideas?.[0]?.vibe).toBeDefined();
    }

    // YouTube output should have 'title' and 'hook'
    if (youtubeOutput && typeof youtubeOutput === 'object') {
      const output = youtubeOutput as { ideas?: Array<{ title?: unknown; hook?: unknown }> };
      expect(output.ideas?.[0]?.title).toBeDefined();
      expect(output.ideas?.[0]?.hook).toBeDefined();
    }
  });
});
