import { describe, it, expect, beforeAll } from 'vitest';

import { prepareTraceContext } from '@/utils/trace-prep.js';
import { TraceRepository } from '@/db/repositories/trace-repository.js';
import { ProjectRepository } from '@/db/repositories/project-repository.js';

describe('Trace playbook integration', () => {
  const traceRepo = new TraceRepository();
  const projectRepo = new ProjectRepository();

  let aismrProjectId: string;

  beforeAll(async () => {
    const project = await projectRepo.findByName('aismr');
    expect(project).toBeTruthy();
    aismrProjectId = project!.id;
  });

  it('includes AISMR guardrails in Casey system prompt', async () => {
    const trace = await traceRepo.create({
      projectId: aismrProjectId,
      currentOwner: 'casey',
      instructions: 'Make an AISMR video about candles',
    });

    const result = await prepareTraceContext({
      traceId: trace.traceId,
      instructions: 'Make an AISMR video about candles',
    });

    expect(result.systemPrompt).toContain('PROJECT GUARDRAILS');
    expect(result.systemPrompt).toContain('technical_constraints');
  });

  it('includes persona expectations for specialists', async () => {
    const trace = await traceRepo.create({
      projectId: aismrProjectId,
      currentOwner: 'iggy',
      instructions: 'Generate 12 surreal modifiers about candles',
    });

    const result = await prepareTraceContext({
      traceId: trace.traceId,
    });

    expect(result.systemPrompt).toContain('YOUR ROLE EXPECTATIONS');
    expect(result.systemPrompt).toContain('12 surreal object-modifier pairs');
  });
});

