#!/usr/bin/env tsx
/**
 * Generate standard code templates for n8n workflows
 * Following patterns from docs/WORKFLOW_BEST_PRACTICES.md
 */

interface Template {
  name: string;
  description: string;
  code: string;
  usage: string;
}

const templates: Template[] = [
  {
    name: 'Normalize State',
    description: 'Extract and flatten workflow run state for easy access',
    usage: 'Use after "Get Run" node to prepare state for processing',
    code: `const payload = $json?.workflowRun ?? $json?.data?.workflowRun ?? null;
if (!payload) {
  throw new Error('Workflow run payload missing from API response.');
}

// Extract metadata
const metadata = {};
if (payload.input && typeof payload.input === 'object') {
  if (payload.input.metadata && typeof payload.input.metadata === 'object') {
    Object.assign(metadata, payload.input.metadata);
  }
  // Extract other metadata fields as needed
  if (payload.input.userId) metadata.userId = payload.input.userId;
  if (payload.input.sessionId) metadata.sessionId = payload.input.sessionId;
}

// Extract stage outputs
const ideaOutput = payload.output?.idea_generation ?? {};
const screenplayOutput = payload.output?.screenplay ?? {};
const videoOutput = payload.output?.video_generation ?? {};
const publishingOutput = payload.output?.publishing ?? {};

// Build normalized output
const normalized = {
  ...payload,
  metadata,
  idea_output: ideaOutput,
  screenplay_output: screenplayOutput,
  video_output: videoOutput,
  publishing_output: publishingOutput,
  runId: payload.id
};

return [{ json: normalized }];`,
  },
  {
    name: 'Mark Stage In Progress',
    description: 'Update workflow run to mark a stage as in progress',
    usage: 'Use before executing stage work to update status',
    code: `const run = $('Get Run').item?.json ?? {};
const stages = run.stages ?? {};
const clone = (value) => (value && typeof value === 'object' ? { ...value } : {});

// Set prior stages as completed if not set
const ideaStage = clone(stages.idea_generation);
if (!ideaStage.status) {
  ideaStage.status = 'completed';
}

const screenplayStage = clone(stages.screenplay);
if (!screenplayStage.status) {
  screenplayStage.status = 'completed';
}

// Mark current stage as in progress
const currentStage = {
  ...clone(stages.video_generation),
  status: 'in_progress',
  startedAt: new Date().toISOString()
};

return {
  status: 'running',
  currentStage: 'video_generation',
  stages: {
    idea_generation: ideaStage,
    screenplay: screenplayStage,
    video_generation: currentStage,
    publishing: clone(stages.publishing)
  },
  output: {
    ...(run.output ?? {}),
    // Preserve all prior stage outputs
    idea_generation: run.output?.idea_generation ?? ideaStage.output ?? {},
    screenplay: run.output?.screenplay ?? screenplayStage.output ?? {}
  }
};`,
  },
  {
    name: 'Mark Stage Complete',
    description: 'Update workflow run to mark a stage as completed and advance',
    usage: 'Use after stage work completes successfully',
    code: `const run = $('Get Run').item?.json ?? {};
const stages = run.stages ?? {};
const clone = (value) => (value && typeof value === 'object' ? { ...value } : {});

// Set prior stages as completed
const ideaStage = clone(stages.idea_generation);
if (!ideaStage.status) {
  ideaStage.status = 'completed';
}

const screenplayStage = clone(stages.screenplay);
if (!screenplayStage.status) {
  screenplayStage.status = 'completed';
}

// Build current stage output from workflow results
const stageOutput = {
  videoUrl: $json.data?.videoUrl ?? null,
  ideaId: $json.data?.ideaId ?? null,
  completedAt: new Date().toISOString()
};

// Mark current stage complete
const currentStage = {
  ...clone(stages.video_generation),
  status: 'completed',
  output: stageOutput
};

// Mark next stage in progress
const nextStage = {
  ...clone(stages.publishing),
  status: 'in_progress',
  startedAt: new Date().toISOString()
};

return {
  status: 'running',
  currentStage: 'publishing',
  stages: {
    idea_generation: ideaStage,
    screenplay: screenplayStage,
    video_generation: currentStage,
    publishing: nextStage
  },
  output: {
    ...(run.output ?? {}),
    // CRITICAL: Preserve ALL prior stage outputs
    idea_generation: run.output?.idea_generation ?? ideaStage.output ?? {},
    screenplay: run.output?.screenplay ?? screenplayStage.output ?? {},
    // Add new stage output
    video_generation: stageOutput
  }
};`,
  },
  {
    name: 'Error Handler',
    description: 'Handle workflow errors while preserving state',
    usage: 'Use in Error Trigger node to handle failures',
    code: `const run = $('Get Run').item?.json ?? {};
const stages = run.stages ?? {};
const clone = (value) => (value && typeof value === 'object' ? { ...value } : {});

// Set prior stages as completed
const ideaStage = clone(stages.idea_generation);
if (!ideaStage.status) {
  ideaStage.status = 'completed';
}

const screenplayStage = clone(stages.screenplay);
if (!screenplayStage.status) {
  screenplayStage.status = 'completed';
}

// Mark current stage failed
const currentStage = {
  ...clone(stages.video_generation),
  status: 'failed',
  error: {
    message: $json.error?.message ?? 'Workflow failed.',
    stack: $json.error?.stack ?? null,
    lastNode: $json.execution?.lastNodeExecuted ?? null,
    timestamp: new Date().toISOString()
  }
};

return {
  status: 'failed',
  currentStage: 'video_generation',
  stages: {
    idea_generation: ideaStage,
    screenplay: screenplayStage,
    video_generation: currentStage,
    publishing: clone(stages.publishing)
  },
  output: {
    ...(run.output ?? {}),
    // CRITICAL: Preserve ALL prior outputs even on failure
    idea_generation: run.output?.idea_generation ?? ideaStage.output ?? {},
    screenplay: run.output?.screenplay ?? screenplayStage.output ?? {},
    video_generation: {
      ...(run.output?.video_generation ?? {}),
      error: {
        message: $json.error?.message ?? 'Workflow failed.',
        stack: $json.error?.stack ?? null,
        lastNode: $json.execution?.lastNodeExecuted ?? null,
        timestamp: new Date().toISOString()
      }
    }
  }
};`,
  },
  {
    name: 'Clone Helper Function',
    description: 'Helper function for safely cloning stage objects',
    usage: 'Include at the start of state manipulation code',
    code: `const clone = (value) => (value && typeof value === 'object' ? { ...value } : {});`,
  },
  {
    name: 'Merge Publishing Output',
    description: 'Merge new publishing data with existing publishing output',
    usage: 'Use when updating publishing stage (edit, upload, etc.)',
    code: `const run = $('Get Run').item?.json ?? {};
const stages = run.stages ?? {};
const clone = (value) => (value && typeof value === 'object' ? { ...value } : {});

// Get existing publishing output (may include editUrl from edit workflow)
const existingPublishing = run.output?.publishing ?? {};

// Build new publishing output - MERGE with existing
const publishingOutput = {
  ...existingPublishing,  // Preserve editUrl, etc.
  tiktokUrl: $json.tiktokUrl,
  platform: 'tiktok',
  caption: $json.caption,
  uploadedAt: new Date().toISOString()
};

// Update publishing stage
const publishingStage = {
  ...clone(stages.publishing),
  status: 'completed',
  output: publishingOutput
};

return {
  status: 'completed',
  currentStage: 'publishing',
  stages: {
    idea_generation: clone(stages.idea_generation),
    screenplay: clone(stages.screenplay),
    video_generation: clone(stages.video_generation),
    publishing: publishingStage
  },
  output: {
    ...(run.output ?? {}),
    // Preserve all prior outputs
    idea_generation: run.output?.idea_generation ?? {},
    screenplay: run.output?.screenplay ?? {},
    video_generation: run.output?.video_generation ?? {},
    // Use merged publishing output
    publishing: publishingOutput
  }
};`,
  },
];

function generateMarkdown(): string {
  let markdown = '# n8n Workflow Code Templates\n\n';
  markdown += '**Generated:** ' + new Date().toISOString() + '\n\n';
  markdown +=
    'Standard code templates for n8n workflows following `docs/WORKFLOW_BEST_PRACTICES.md`\n\n';
  markdown += '---\n\n';

  for (const template of templates) {
    markdown += `## ${template.name}\n\n`;
    markdown += `**Description:** ${template.description}\n\n`;
    markdown += `**Usage:** ${template.usage}\n\n`;
    markdown += '```javascript\n';
    markdown += template.code;
    markdown += '\n```\n\n';
    markdown += '---\n\n';
  }

  return markdown;
}

function printTemplates(): void {
  console.log('\n' + '='.repeat(80));
  console.log('N8N WORKFLOW CODE TEMPLATES');
  console.log('='.repeat(80) + '\n');

  for (let i = 0; i < templates.length; i++) {
    const template = templates[i];
    console.log(`${i + 1}. ${template.name}`);
    console.log(`   ${template.description}`);
    console.log(`   Usage: ${template.usage}\n`);
  }

  console.log('='.repeat(80));
  console.log(`\nGenerate with: npm run generate:workflow-templates\n`);
}

function main(): void {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === 'list') {
    printTemplates();
    return;
  }

  if (command === 'show' && args[1]) {
    const index = parseInt(args[1]) - 1;
    if (index >= 0 && index < templates.length) {
      const template = templates[index];
      console.log(`\n${template.name}`);
      console.log('='.repeat(template.name.length));
      console.log(`\n${template.description}`);
      console.log(`\nUsage: ${template.usage}\n`);
      console.log('```javascript');
      console.log(template.code);
      console.log('```\n');
      return;
    }
    console.error('Invalid template number');
    process.exit(1);
  }

  // Default: generate markdown file
  const fs = require('node:fs');
  const path = require('node:path');
  const outputPath = path.join(process.cwd(), 'docs', 'WORKFLOW_CODE_TEMPLATES.md');

  const markdown = generateMarkdown();
  fs.writeFileSync(outputPath, markdown);

  console.log('\n✅ Templates generated successfully!');
  console.log(`📄 File: ${outputPath}\n`);
  console.log('Available templates:');
  printTemplates();
}

if (require.main === module) {
  main();
}

export { templates, type Template };
