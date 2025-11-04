#!/usr/bin/env tsx
/**
 * Workflow and n8n utilities
 * Usage: tsx scripts/workflow-utils.ts <command>
 * Commands: sync-push, sync-pull, extract-schemas, inject-schemas, validate-specs, validate-workflows, format, generate-templates
 */

import { spawn } from 'node:child_process';

const commands = {
  'sync-push': './scripts/n8nSync.ts --push',
  'sync-pull': './scripts/n8nSync.ts --pull',
  'extract-schemas': './scripts/extractSchemas.ts',
  'inject-schemas': './scripts/injectSchemas.ts',
  'validate-specs': './scripts/validateToolSpecs.ts',
  'validate-workflows': './scripts/validateWorkflowState.ts',
  format: './scripts/formatWorkflows.ts',
  'generate-templates': './scripts/generateWorkflowTemplates.ts',
};

function showHelp() {
  console.log('Workflow and n8n Utilities');
  console.log('');
  console.log('Usage: tsx scripts/workflow-utils.ts <command>');
  console.log('');
  console.log('n8n Sync:');
  console.log('  sync-push         - Push workflows to n8n');
  console.log('  sync-pull         - Pull workflows from n8n');
  console.log('');
  console.log('Schema Management:');
  console.log('  extract-schemas   - Extract schemas from workflows');
  console.log('  inject-schemas    - Inject schemas into workflows');
  console.log('');
  console.log('Validation:');
  console.log('  validate-specs    - Validate tool specifications');
  console.log('  validate-workflows - Validate workflow state');
  console.log('');
  console.log('Utilities:');
  console.log('  format            - Format workflow JSON files');
  console.log('  generate-templates - Generate workflow templates');
  console.log('');
}

async function runScript(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('tsx', [command, ...args], {
      stdio: 'inherit',
      cwd: process.cwd(),
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Script exited with code ${code}`));
      }
    });
  });
}

async function main() {
  const command = process.argv[2];

  if (!command || command === '--help' || command === '-h') {
    showHelp();
    process.exit(0);
  }

  const scriptCommand = commands[command as keyof typeof commands];

  if (!scriptCommand) {
    console.error(`Unknown command: ${command}`);
    console.error('');
    showHelp();
    process.exit(1);
  }

  const [scriptPath, ...defaultArgs] = scriptCommand.split(' ');
  const userArgs = process.argv.slice(3);

  try {
    await runScript(scriptPath, [...defaultArgs, ...userArgs]);
  } catch (error) {
    console.error('Failed:', error);
    process.exit(1);
  }
}

main();
