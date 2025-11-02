import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';

const specsDir = join(process.cwd(), 'docs', 'tool-specs');

const REQUIRED_FIELDS = ['id', 'name', 'version', 'description', 'input_schema', 'output_schema'];
const REQUIRED_INPUT_SCHEMA_FIELDS = ['type'];
const REQUIRED_OUTPUT_SCHEMA_FIELDS = ['type'];

function validateSpec(data: unknown, file: string): string[] {
  const errors: string[] = [];

  if (!data || typeof data !== 'object') {
    errors.push('Root must be an object');
    return errors;
  }

  const tool = (data as { tool?: unknown }).tool;
  if (!tool || typeof tool !== 'object') {
    errors.push('Missing "tool" property');
    return errors;
  }

  const toolObj = tool as Record<string, unknown>;

  for (const field of REQUIRED_FIELDS) {
    if (!(field in toolObj)) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  if ('input_schema' in toolObj) {
    const inputSchema = toolObj.input_schema;
    if (!inputSchema || typeof inputSchema !== 'object') {
      errors.push('input_schema must be an object');
    } else {
      const schema = inputSchema as Record<string, unknown>;
      if (!('type' in schema)) {
        errors.push('input_schema missing "type" property');
      }
    }
  }

  if ('output_schema' in toolObj) {
    const outputSchema = toolObj.output_schema;
    if (!outputSchema || typeof outputSchema !== 'object') {
      errors.push('output_schema must be an object');
    } else {
      const schema = outputSchema as Record<string, unknown>;
      if (!('type' in schema)) {
        errors.push('output_schema missing "type" property');
      }
    }
  }

  if ('id' in toolObj && typeof toolObj.id === 'string') {
    if (!/^[a-z0-9_.-]+(\.[a-z0-9_.-]+)*$/.test(toolObj.id)) {
      errors.push('id must match pattern: ^[a-z0-9_.-]+(\\.[a-z0-9_.-]+)*$');
    }
  }

  if ('name' in toolObj && typeof toolObj.name === 'string') {
    if (!/^[a-z0-9]+(?:[_.-][a-z0-9]+)*$/.test(toolObj.name)) {
      errors.push('name must match pattern: ^[a-z0-9]+(?:[_.-][a-z0-9]+)*$');
    }
  }

  return errors;
}

const specFiles = readdirSync(specsDir)
  .filter((file) => file.endsWith('.yml') && file !== 'README.md')
  .sort();

let totalErrors = 0;
let totalFiles = 0;

console.log(`Validating ${specFiles.length} tool spec files...\n`);

for (const file of specFiles) {
  const filePath = join(specsDir, file);
  totalFiles++;

  try {
    const content = readFileSync(filePath, 'utf-8');
    const data = yaml.load(content);

    const errors = validateSpec(data, file);

    if (errors.length > 0) {
      console.error(`❌ ${file}:`);
      for (const error of errors) {
        console.error(`   ${error}`);
      }
      console.error('');
      totalErrors += errors.length;
    } else {
      console.log(`✅ ${file}`);
    }
  } catch (error) {
    console.error(`❌ ${file}: ${error instanceof Error ? error.message : String(error)}`);
    totalErrors++;
  }
}

console.log(`\nValidation complete: ${totalFiles} files, ${totalErrors} errors`);

if (totalErrors > 0) {
  process.exit(1);
}

