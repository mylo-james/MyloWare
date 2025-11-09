#!/usr/bin/env tsx
/**
 * Data Ingestion Pipeline
 * 
 * Validates and upserts data/v1 artifacts into the database:
 * - Personas → personas table
 * - Projects → projects table
 * - Guardrails → memories table (semantic)
 * - Workflows → memories table (procedural)
 * 
 * Usage:
 *   npm run ingest-data
 *   npm run ingest-data -- --dry-run
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { PersonaRepository } from '../../src/db/repositories/persona-repository.js';
import { ProjectRepository } from '../../src/db/repositories/project-repository.js';
import { MemoryRepository } from '../../src/db/repositories/memory-repository.js';
import { embedText } from '../../src/utils/embedding.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_V1_ROOT = join(__dirname, '../../data/v1');
const SCHEMAS_ROOT = join(DATA_V1_ROOT, 'schemas');

// Initialize AJV with formats
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

interface IngestStats {
  personas: { created: number; updated: number; errors: number };
  projects: { created: number; updated: number; errors: number };
  guardrails: { created: number; errors: number };
  workflows: { created: number; errors: number };
}

const stats: IngestStats = {
  personas: { created: 0, updated: 0, errors: 0 },
  projects: { created: 0, updated: 0, errors: 0 },
  guardrails: { created: 0, errors: 0 },
  workflows: { created: 0, errors: 0 },
};

/**
 * Load and compile a JSON schema
 */
function loadSchema(schemaName: string) {
  const schemaPath = join(SCHEMAS_ROOT, `${schemaName}.schema.json`);
  const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));
  return ajv.compile(schema);
}

/**
 * Validate artifact against schema
 */
function validateArtifact(artifact: unknown, schemaName: string): boolean {
  const validate = loadSchema(schemaName);
  const valid = validate(artifact);
  if (!valid) {
    console.error(`❌ Validation failed for ${schemaName}:`);
    console.error(JSON.stringify(validate.errors, null, 2));
    return false;
  }
  return true;
}

/**
 * Ingest a persona
 */
async function ingestPersona(personaPath: string, dryRun: boolean): Promise<void> {
  try {
    const personaFile = join(personaPath, 'persona.json');
    const persona = JSON.parse(readFileSync(personaFile, 'utf-8'));

    if (!validateArtifact(persona, 'persona')) {
      stats.personas.errors++;
      return;
    }

    // Load additional files
    const promptPath = join(personaPath, 'prompt.md');
    const capabilitiesPath = join(personaPath, 'capabilities.json');
    
    let systemPrompt = '';
    let capabilities: string[] = [];

    try {
      systemPrompt = readFileSync(promptPath, 'utf-8');
    } catch (error) {
      console.warn(`⚠️  No prompt.md found for ${persona.name}`, error instanceof Error ? error.message : error);
    }

    try {
      const capabilitiesData = JSON.parse(readFileSync(capabilitiesPath, 'utf-8'));
      capabilities = capabilitiesData.capabilities || [];
    } catch (error) {
      console.warn(
        `⚠️  No capabilities.json found for ${persona.name}`,
        error instanceof Error ? error.message : error,
      );
    }

    if (dryRun) {
      console.log(`✓ [DRY RUN] Would upsert persona: ${persona.name}`);
      stats.personas.created++;
      return;
    }

    const repository = new PersonaRepository();
    const existing = await repository.findByName(persona.name);

    const personaData = {
      name: persona.name,
      description: persona.description || '',
      capabilities,
      tone: persona.tone,
      defaultProject: persona.defaultProject || null,
      systemPrompt: systemPrompt || null,
      allowedTools: persona.allowedTools || [],
      metadata: persona.metadata || {},
    };

    if (existing) {
      await repository.update(existing.id, personaData);
      console.log(`♻️  Updated persona: ${persona.name}`);
      stats.personas.updated++;
    } else {
      await repository.insert(personaData);
      console.log(`✅ Created persona: ${persona.name}`);
      stats.personas.created++;
    }
  } catch (error) {
    console.error(`❌ Error ingesting persona at ${personaPath}:`, error);
    stats.personas.errors++;
  }
}

/**
 * Ingest a project
 */
async function ingestProject(projectPath: string, dryRun: boolean): Promise<void> {
  try {
    const projectFile = join(projectPath, 'project.json');
    const project = JSON.parse(readFileSync(projectFile, 'utf-8'));

    if (!validateArtifact(project, 'project')) {
      stats.projects.errors++;
      return;
    }

    if (dryRun) {
      console.log(`✓ [DRY RUN] Would upsert project: ${project.name}`);
      stats.projects.created++;
      return;
    }

    const repository = new ProjectRepository();
    const existing = await repository.findByName(project.name);

    const projectData = {
      name: project.name,
      description: project.description || '',
      workflow: project.workflow || [],
      optionalSteps: project.optionalSteps || [],
      guardrails: project.guardrails || {},
      settings: project.settings || {},
      metadata: project.metadata || {},
    };

    if (existing) {
      await repository.update(existing.id, projectData);
      console.log(`♻️  Updated project: ${project.name}`);
      stats.projects.updated++;
    } else {
      await repository.insert(projectData);
      console.log(`✅ Created project: ${project.name}`);
      stats.projects.created++;
    }
  } catch (error) {
    console.error(`❌ Error ingesting project at ${projectPath}:`, error);
    stats.projects.errors++;
  }
}

/**
 * Ingest a guardrail as a semantic memory
 */
async function ingestGuardrail(guardrailPath: string, dryRun: boolean): Promise<void> {
  try {
    const guardrail = JSON.parse(readFileSync(guardrailPath, 'utf-8'));

    if (!validateArtifact(guardrail, 'guardrail')) {
      stats.guardrails.errors++;
      return;
    }

    const content = `Guardrail ${guardrail.key}: ${guardrail.rule}`;
    
    if (dryRun) {
      console.log(`✓ [DRY RUN] Would store guardrail: ${guardrail.key}`);
      stats.guardrails.created++;
      return;
    }

    const embedding = await embedText(content);
    const repository = new MemoryRepository();

    await repository.insert({
      content,
      summary: null,
      embedding,
      memoryType: 'semantic',
      persona: [],
      project: guardrail.links?.project ? [guardrail.links.project] : [],
      tags: guardrail.metadata?.tags || ['guardrail'],
      relatedTo: [],
      lastAccessedAt: null,
      accessCount: 0,
      metadata: {
        ...guardrail.metadata,
        guardrailKey: guardrail.key,
        category: guardrail.category,
        name: guardrail.name,
        sourceType: 'guardrail',
      },
    });

    console.log(`✅ Stored guardrail: ${guardrail.key}`);
    stats.guardrails.created++;
  } catch (error) {
    console.error(`❌ Error ingesting guardrail at ${guardrailPath}:`, error);
    stats.guardrails.errors++;
  }
}

/**
 * Ingest a workflow as a procedural memory
 */
async function ingestWorkflow(workflowPath: string, dryRun: boolean): Promise<void> {
  try {
    const workflowFile = join(workflowPath, 'workflow.json');
    const workflow = JSON.parse(readFileSync(workflowFile, 'utf-8'));

    if (!validateArtifact(workflow, 'workflow')) {
      stats.workflows.errors++;
      return;
    }

    const content = `Workflow ${workflow.workflowKey}: ${workflow.description}`;
    
    if (dryRun) {
      console.log(`✓ [DRY RUN] Would store workflow: ${workflow.workflowKey}`);
      stats.workflows.created++;
      return;
    }

    const embedding = await embedText(content);
    const repository = new MemoryRepository();

    await repository.insert({
      content,
      summary: null,
      embedding,
      memoryType: 'procedural',
      persona: workflow.ownerPersona ? [workflow.ownerPersona] : [],
      project: workflow.project ? [workflow.project] : [],
      tags: workflow.metadata?.tags || ['workflow', 'definition'],
      relatedTo: [],
      lastAccessedAt: null,
      accessCount: 0,
      metadata: {
        ...workflow.metadata,
        workflowKey: workflow.workflowKey,
        ownerPersona: workflow.ownerPersona,
        project: workflow.project,
        sourceType: 'workflow',
      },
    });

    console.log(`✅ Stored workflow: ${workflow.workflowKey}`);
    stats.workflows.created++;
  } catch (error) {
    console.error(`❌ Error ingesting workflow at ${workflowPath}:`, error);
    stats.workflows.errors++;
  }
}

/**
 * Build link graph (related_to edges) between memories
 */
async function buildLinkGraph(dryRun: boolean): Promise<void> {
  if (dryRun) {
    console.log('\n🔗 [DRY RUN] Would build link graph');
    return;
  }

  console.log('\n🔗 Building link graph...');
  const repository = new MemoryRepository();

  // Find all workflows
  const workflows = await repository.keywordSearch('workflow', {
    memoryTypes: ['procedural'],
    limit: 100,
  });

  for (const workflow of workflows) {
    const workflowKey = workflow.metadata.workflowKey as string;
    if (!workflowKey) continue;

    // Find linked guardrails from workflow metadata
    const linkedGuardrails = (workflow.metadata.guardrails as string[]) || [];
    
    // Find guardrail memories by key
    const guardrailIds: string[] = [];
    for (const guardrailKey of linkedGuardrails) {
      const guardrails = await repository.keywordSearch(guardrailKey, {
        memoryTypes: ['semantic'],
        limit: 1,
      });
      if (guardrails.length > 0) {
        guardrailIds.push(guardrails[0].id);
      }
    }

    // Update workflow with guardrail links
    if (guardrailIds.length > 0) {
      await repository.update(workflow.id, {
        relatedTo: [...new Set([...workflow.relatedTo, ...guardrailIds])],
      });
      console.log(`  ✓ Linked workflow ${workflowKey} to ${guardrailIds.length} guardrails`);
    }
  }

  console.log('✅ Link graph built');
}

/**
 * Discover and ingest all artifacts
 */
async function discoverAndIngest(dryRun: boolean): Promise<void> {
  console.log('🔍 Discovering artifacts...\n');

  // Ingest personas
  const personasDir = join(DATA_V1_ROOT, 'personas');
  const personas = readdirSync(personasDir).filter((name) =>
    statSync(join(personasDir, name)).isDirectory()
  );
  
  console.log(`📦 Ingesting ${personas.length} personas...`);
  for (const persona of personas) {
    await ingestPersona(join(personasDir, persona), dryRun);
  }

  // Ingest projects
  const projectsDir = join(DATA_V1_ROOT, 'projects');
  const projects = readdirSync(projectsDir).filter((name) =>
    statSync(join(projectsDir, name)).isDirectory()
  );
  
  console.log(`\n📦 Ingesting ${projects.length} projects...`);
  for (const project of projects) {
    await ingestProject(join(projectsDir, project), dryRun);
  }

  // Ingest guardrails
  console.log('\n📦 Ingesting guardrails...');
  for (const project of projects) {
    const guardrailsDir = join(projectsDir, project, 'guardrails');
    try {
      const guardrails = readdirSync(guardrailsDir).filter((name) =>
        name.endsWith('.json')
      );
      for (const guardrail of guardrails) {
        await ingestGuardrail(join(guardrailsDir, guardrail), dryRun);
      }
    } catch (error) {
      // No guardrails directory for this project
      console.warn(
        `⚠️  No guardrails directory for project ${project}`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  // Ingest workflows
  console.log('\n📦 Ingesting workflows...');
  const workflowsDir = join(DATA_V1_ROOT, 'workflows');
  try {
    const workflowProjects = readdirSync(workflowsDir).filter((name) =>
      statSync(join(workflowsDir, name)).isDirectory()
    );
    for (const project of workflowProjects) {
      const projectWorkflowsDir = join(workflowsDir, project);
      const workflows = readdirSync(projectWorkflowsDir).filter((name) =>
        statSync(join(projectWorkflowsDir, name)).isDirectory()
      );
      for (const workflow of workflows) {
        await ingestWorkflow(join(projectWorkflowsDir, workflow), dryRun);
      }
    }
  } catch (error) {
    console.warn('⚠️  No workflows directory found', error instanceof Error ? error.message : error);
  }

  // Build link graph
  await buildLinkGraph(dryRun);
}

/**
 * Print summary statistics
 */
function printStats(): void {
  console.log('\n📊 Ingestion Summary:');
  console.log('─────────────────────');
  console.log(`Personas: ${stats.personas.created} created, ${stats.personas.updated} updated, ${stats.personas.errors} errors`);
  console.log(`Projects: ${stats.projects.created} created, ${stats.projects.updated} updated, ${stats.projects.errors} errors`);
  console.log(`Guardrails: ${stats.guardrails.created} stored, ${stats.guardrails.errors} errors`);
  console.log(`Workflows: ${stats.workflows.created} stored, ${stats.workflows.errors} errors`);
  
  const totalErrors = stats.personas.errors + stats.projects.errors + stats.guardrails.errors + stats.workflows.errors;
  if (totalErrors > 0) {
    console.log(`\n⚠️  ${totalErrors} total errors encountered`);
    process.exit(1);
  } else {
    console.log('\n✅ Ingestion completed successfully');
  }
}

/**
 * Main execution
 */
async function main() {
  const dryRun = process.argv.includes('--dry-run');
  
  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No database changes will be made\n');
  }

  console.log('🚀 Starting data ingestion pipeline...\n');
  
  try {
    await discoverAndIngest(dryRun);
    printStats();
  } catch (error) {
    console.error('❌ Fatal error during ingestion:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});


