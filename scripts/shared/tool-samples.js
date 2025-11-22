export const SAMPLE_TIMESTAMP = '2025-11-10T02:15:00.000Z';

export const TOOL_SAMPLE_ORDER = [
  'memory_search',
  'memory_store',
  'trace_prepare',
  'trace_update',
  'handoff_to_agent',
  'jobs',
  'workflow_trigger',
  'web_search',
  'web_read',
  'knowledge_ingest',
  'knowledge_get',
];

export const TOOL_SAMPLES = {
  memory_search: {
    input: {
      traceId: 'trace-123',
      query: 'modifier inspiration',
      limit: 3,
    },
    output: {
      memories: [
        {
          id: 'mem-001',
          content: 'Generated 12 AISMR modifiers anchored to “porcelain mug”.',
          summary: null,
          memoryType: 'episodic',
          persona: ['iggy'],
          project: ['aismr'],
          tags: ['modifiers', 'approved'],
          relatedTo: [],
          metadata: { traceId: 'trace-123' },
          createdAt: SAMPLE_TIMESTAMP,
          updatedAt: SAMPLE_TIMESTAMP,
          lastAccessedAt: SAMPLE_TIMESTAMP,
          accessCount: 2,
          relevanceScore: 0.92,
        },
      ],
      totalFound: 1,
      searchTime: 7,
    },
  },
  memory_store: {
    input: {
      traceId: 'trace-123',
      content: 'Logged Alex handoff after storyboard sign-off.',
      memoryType: 'episodic',
      persona: ['brendan'],
      project: ['aismr'],
      tags: ['handoff', 'alex'],
    },
    output: {
      id: 'mem-002',
      content: 'Logged Alex handoff after storyboard sign-off.',
      summary: null,
      memoryType: 'episodic',
      persona: ['brendan'],
      project: ['aismr'],
      tags: ['handoff', 'alex'],
      relatedTo: [],
      metadata: { traceId: 'trace-123' },
      createdAt: SAMPLE_TIMESTAMP,
      updatedAt: SAMPLE_TIMESTAMP,
      lastAccessedAt: null,
      accessCount: 0,
    },
  },
  trace_prepare: {
    input: {
      traceId: 'trace-123',
      instructions: 'Create a surreal coffee mug concept.',
      memoryLimit: 5,
    },
    output: {
      traceId: 'trace-123',
      justCreated: false,
      trace: {
        traceId: 'trace-123',
        projectId: '3a59b1e0-b42e-4a36-a7d4-e23c8bb679ef',
        currentOwner: 'iggy',
        status: 'active',
        instructions: 'Create a surreal coffee mug concept.',
        workflowStep: 1,
      },
      persona: {
        name: 'iggy',
        description: 'Creative Director focused on AISMR concepts.',
        allowedTools: ['memory_search', 'memory_store', 'handoff_to_agent'],
      },
      project: {
        id: '3a59b1e0-b42e-4a36-a7d4-e23c8bb679ef',
        name: 'aismr',
        description: '8-second micro-films of impossible objects.',
        workflow: ['brendan', 'iggy', 'riley', 'alex', 'quinn'],
      },
      memorySummary: '2 most recent memories loaded.',
    },
  },
  trace_update: {
    input: {
      traceId: 'trace-123',
      projectId: 'aismr',
      instructions: 'Focus on porcelain textures.',
    },
    output: {
      traceId: 'trace-123',
      projectId: '3a59b1e0-b42e-4a36-a7d4-e23c8bb679ef',
      currentOwner: 'brendan',
      instructions: 'Focus on porcelain textures.',
      workflowStep: 0,
      status: 'active',
      metadata: {},
      updatedAt: SAMPLE_TIMESTAMP,
    },
  },
  handoff_to_agent: {
    input: {
      traceId: 'trace-123',
      toAgent: 'riley',
      instructions: 'Draft screenplay from the approved modifiers.',
      metadata: {
        runId: 'run-789',
      },
    },
    output: {
      webhookUrl: 'https://example.com/webhook/myloware/ingest',
      executionId: '8642',
      status: 'success',
      toAgent: 'riley',
    },
  },
  jobs: {
    input: {
      action: 'summary',
      traceId: 'trace-123',
    },
    output: {
      total: 2,
      completed: 1,
      failed: 0,
      pending: 1,
      breakdown: {
        video: { total: 1, completed: 1, failed: 0, pending: 0 },
        edit: { total: 1, completed: 0, failed: 0, pending: 1 },
      },
    },
  },
  workflow_trigger: {
    input: {
      workflowKey: 'generate-video',
      traceId: 'trace-123',
      payload: {
        screenplay: {
          id: 'sc-555',
        },
      },
      environment: 'development',
    },
    output: {
      status: 'success',
      executionId: '1975',
      toAgent: 'generate-video',
    },
  },
  web_search: {
    input: {
      query: 'MyloWare AI production studio',
      numResults: 3,
    },
    output: {
      query: 'MyloWare AI production studio',
      numResults: 2,
      fetchedAt: SAMPLE_TIMESTAMP,
      results: [
        {
          title: 'MyloWare — Memory-first Production',
          url: 'https://myloware.ai/',
          snippet: 'Introducing the memory-first AI production studio for short-form video.',
        },
        {
          title: 'Model Context Protocol Overview',
          url: 'https://modelcontextprotocol.io/',
          snippet: 'Specification for the MCP system used by MyloWare agents.',
        },
      ],
    },
  },
  web_read: {
    input: {
      url: 'https://example.com',
      maxChars: 2000,
    },
    output: {
      title: 'Example Domain',
      url: 'https://example.com',
      text: 'Example Domain This domain is for use in illustrative examples in documents.',
      metadata: {
        fetchedAt: SAMPLE_TIMESTAMP,
      },
    },
  },
  knowledge_ingest: {
    input: {
      traceId: 'trace-123',
      text: 'Outline of Alex normalization guardrails for AISMR videos.',
      bias: {
        persona: ['alex'],
        project: ['aismr'],
      },
    },
    output: {
      inserted: 1,
      updated: 0,
      skipped: 0,
      totalChunks: 1,
    },
  },
  knowledge_get: {
    input: {
      query: 'Alex normalization guardrails',
      persona: 'alex',
      project: 'aismr',
      limit: 2,
    },
    output: {
      knowledge: [
        {
          id: 'mem-knowledge-001',
          content: 'Alex must keep camera moves under 3 seconds and maintain vertical framing.',
          summary: null,
          memoryType: 'episodic',
          persona: ['alex'],
          project: ['aismr'],
          tags: ['knowledge', 'guardrails'],
          relatedTo: [],
          metadata: { traceId: 'trace-knowledge-123' },
          createdAt: SAMPLE_TIMESTAMP,
          updatedAt: SAMPLE_TIMESTAMP,
          lastAccessedAt: SAMPLE_TIMESTAMP,
          accessCount: 4,
        },
      ],
      totalFound: 1,
      query: 'Alex normalization guardrails',
    },
  },
};
