import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { registerApiRoutes } from '../../server/routes/api';
import { registerHITLRoutes } from '../../server/routes/hitl';
import { registerWorkflowRunRoutes } from '../../server/routes/workflow-runs';
import { WorkflowRunRepository } from '../../db/operations/workflowRunRepository';
import { HITLRepository } from '../../db/operations/hitlRepository';
import { HITLService } from '../../services/hitl/HITLService';
import { EpisodicMemoryRepository } from '../../db/episodicRepository';

/**
 * End-to-end integration test for HITL flow
 *
 * This test verifies the complete HITL workflow:
 * 1. Create workflow run
 * 2. Request HITL approval
 * 3. Get pending approvals
 * 4. Approve/reject approval
 * 5. Verify workflow run status updates
 *
 * Note: This test requires a test database. Set TEST_DATABASE_URL environment variable
 * to run against a real database, or use mocks (current implementation uses real repositories).
 */
describe('HITL End-to-End Flow', () => {
  let app: FastifyInstance;
  let workflowRunRepo: WorkflowRunRepository;
  let hitlRepo: HITLRepository;
  let hitlService: HITLService;

  beforeEach(async () => {
    // Only run if TEST_DATABASE_URL is set
    if (!process.env.TEST_DATABASE_URL && !process.env.OPERATIONS_DATABASE_URL) {
      // Skip if no test database configured
      return;
    }

    app = fastify({ logger: false });
    workflowRunRepo = new WorkflowRunRepository();
    hitlRepo = new HITLRepository();
    hitlService = new HITLService(workflowRunRepo, hitlRepo);

    await registerApiRoutes(app, {
      hitlService,
      episodicRepository: new EpisodicMemoryRepository(),
    });
    await registerHITLRoutes(app, { hitlService });
    await registerWorkflowRunRoutes(app);
    await app.ready();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it('should complete full HITL approval flow for idea generation', async () => {
    // Skip if no test database
    if (!process.env.TEST_DATABASE_URL && !process.env.OPERATIONS_DATABASE_URL) {
      return;
    }

    const projectId = 'aismr';
    const sessionId = randomUUID();
    const workflowRunId = randomUUID();

    // Step 1: Create workflow run
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/workflow-runs',
      payload: {
        id: workflowRunId,
        projectId,
        sessionId,
        input: { userInput: 'Create an ASMR video about puppies' },
      },
    });

    expect(createResponse.statusCode).toBe(201);
    const createdRun = createResponse.json().workflowRun;
    expect(createdRun.id).toBe(workflowRunId);
    expect(createdRun.status).toBe('running');
    expect(createdRun.currentStage).toBe('idea_generation');

    // Step 2: Request HITL approval
    const requestResponse = await app.inject({
      method: 'POST',
      url: '/api/hitl/request-approval',
      payload: {
        workflowRunId,
        stage: 'idea_generation',
        content: {
          ideas: [
            { idea: 'Puppy Snuggles', vibe: 'Cozy and warm' },
            { idea: 'Puppy Playtime', vibe: 'Energetic and fun' },
          ],
          userIdea: 'puppies',
          totalIdeas: 2,
        },
        notifyChannels: ['slack'],
      },
    });

    expect(requestResponse.statusCode).toBe(201);
    const approval = requestResponse.json().approval;
    expect(approval.workflowRunId).toBe(workflowRunId);
    expect(approval.stage).toBe('idea_generation');
    expect(approval.status).toBe('pending');

    // Step 3: Verify workflow run status updated to waiting_for_hitl
    const runResponse = await app.inject({
      method: 'GET',
      url: `/api/workflow-runs/${workflowRunId}`,
    });

    expect(runResponse.statusCode).toBe(200);
    const updatedRun = runResponse.json().workflowRun;
    expect(updatedRun.status).toBe('waiting_for_hitl');

    // Step 4: Get pending approvals
    const pendingResponse = await app.inject({
      method: 'GET',
      url: '/api/hitl/pending?stage=idea_generation',
    });

    expect(pendingResponse.statusCode).toBe(200);
    const pendingApprovals = pendingResponse.json().approvals;
    expect(pendingApprovals.length).toBeGreaterThan(0);
    const foundApproval = pendingApprovals.find(
      (a: { id: string }) => a.id === approval.id,
    );
    expect(foundApproval).toBeDefined();

    // Step 5: Get specific approval details
    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/hitl/approval/${approval.id}`,
    });

    expect(detailResponse.statusCode).toBe(200);
    const approvalDetail = detailResponse.json().approval;
    expect(approvalDetail.id).toBe(approval.id);
    expect(approvalDetail.content.ideas).toBeDefined();

    // Step 6: Approve the approval with selected idea
    const selectedIdea = approvalDetail.content.ideas[0];
    const approveResponse = await app.inject({
      method: 'POST',
      url: `/api/hitl/approve/${approval.id}`,
      payload: {
        reviewedBy: 'test-user',
        selectedItem: selectedIdea,
        feedback: 'Great idea selection!',
      },
    });

    expect(approveResponse.statusCode).toBe(200);

    // Step 7: Verify approval status updated
    const approvedDetailResponse = await app.inject({
      method: 'GET',
      url: `/api/hitl/approval/${approval.id}`,
    });

    expect(approvedDetailResponse.statusCode).toBe(200);
    const approvedDetail = approvedDetailResponse.json().approval;
    expect(approvedDetail.status).toBe('approved');
    expect(approvedDetail.reviewedBy).toBe('test-user');
    expect(approvedDetail.reviewedAt).toBeDefined();

    // Step 8: Verify approval no longer in pending list
    const pendingAfterResponse = await app.inject({
      method: 'GET',
      url: '/api/hitl/pending?stage=idea_generation',
    });

    expect(pendingAfterResponse.statusCode).toBe(200);
    const pendingAfter = pendingAfterResponse.json().approvals;
    const stillPending = pendingAfter.find((a: { id: string }) => a.id === approval.id);
    expect(stillPending).toBeUndefined();
  });

  it('should complete full HITL rejection flow', async () => {
    // Skip if no test database
    if (!process.env.TEST_DATABASE_URL && !process.env.OPERATIONS_DATABASE_URL) {
      return;
    }

    const projectId = 'aismr';
    const sessionId = randomUUID();
    const workflowRunId = randomUUID();

    // Step 1: Create workflow run
    await app.inject({
      method: 'POST',
      url: '/api/workflow-runs',
      payload: {
        id: workflowRunId,
        projectId,
        sessionId,
        input: { userInput: 'Create an ASMR video about kittens' },
      },
    });

    // Step 2: Request HITL approval
    const requestResponse = await app.inject({
      method: 'POST',
      url: '/api/hitl/request-approval',
      payload: {
        workflowRunId,
        stage: 'idea_generation',
        content: {
          ideas: [{ idea: 'Kitten Cuddles', vibe: 'Soft and gentle' }],
          userIdea: 'kittens',
        },
      },
    });

    const approval = requestResponse.json().approval;

    // Step 3: Reject the approval
    const rejectResponse = await app.inject({
      method: 'POST',
      url: `/api/hitl/reject/${approval.id}`,
      payload: {
        reviewedBy: 'test-user',
        reason: 'Ideas do not meet quality standards',
      },
    });

    expect(rejectResponse.statusCode).toBe(200);

    // Step 4: Verify approval status updated
    const rejectedDetailResponse = await app.inject({
      method: 'GET',
      url: `/api/hitl/approval/${approval.id}`,
    });

    expect(rejectedDetailResponse.statusCode).toBe(200);
    const rejectedDetail = rejectedDetailResponse.json().approval;
    expect(rejectedDetail.status).toBe('rejected');
    expect(rejectedDetail.reviewedBy).toBe('test-user');
    expect(rejectedDetail.feedback).toBe('Ideas do not meet quality standards');
  });

  it('should handle workflow run stage transitions correctly', async () => {
    // Skip if no test database
    if (!process.env.TEST_DATABASE_URL && !process.env.OPERATIONS_DATABASE_URL) {
      return;
    }

    const projectId = 'aismr';
    const sessionId = randomUUID();
    const workflowRunId = randomUUID();

    // Step 1: Create workflow run
    await app.inject({
      method: 'POST',
      url: '/api/workflow-runs',
      payload: {
        id: workflowRunId,
        projectId,
        sessionId,
        input: { userInput: 'Create an ASMR video' },
      },
    });

    // Step 2: Request approval
    const requestResponse = await app.inject({
      method: 'POST',
      url: '/api/hitl/request-approval',
      payload: {
        workflowRunId,
        stage: 'idea_generation',
        content: { ideas: [] },
      },
    });

    const approval = requestResponse.json().approval;

    // Step 3: Verify workflow run is waiting
    let runResponse = await app.inject({
      method: 'GET',
      url: `/api/workflow-runs/${workflowRunId}`,
    });
    let run = runResponse.json().workflowRun;
    expect(run.status).toBe('waiting_for_hitl');

    // Step 4: Approve and verify stage transition
    await app.inject({
      method: 'POST',
      url: `/api/hitl/approve/${approval.id}`,
      payload: {
        reviewedBy: 'test-user',
        feedback: 'Approved',
      },
    });

    // Step 5: Verify workflow run can transition to next stage
    const updateResponse = await app.inject({
      method: 'PATCH',
      url: `/api/workflow-runs/${workflowRunId}`,
      payload: {
        status: 'running',
        currentStage: 'screenplay',
        stages: {
          idea_generation: { status: 'completed' },
          screenplay: { status: 'running' },
          video_generation: { status: 'pending' },
          publishing: { status: 'pending' },
        },
      },
    });

    expect(updateResponse.statusCode).toBe(200);
    const updatedRun = updateResponse.json().workflowRun;
    expect(updatedRun.currentStage).toBe('screenplay');
    expect(updatedRun.status).toBe('running');
  });
});

