#!/usr/bin/env node
import 'dotenv/config';
import { promises as fs } from 'node:fs';
import path from 'node:path';

interface SchemaMapping {
  schemaFile: string;
  workflowFile: string;
  nodeId: string;
  nodeName: string;
}

const SCHEMA_MAPPINGS: SchemaMapping[] = [
  {
    schemaFile: 'schemas/aismr-idea-output.schema.json',
    workflowFile: 'workflows/generate-ideas.workflow.json',
    nodeId: '83094251-2b62-4449-8bcc-e585c4a81450',
    nodeName: 'Structured Output Parser',
  },
  {
    schemaFile: 'schemas/aismr-screenplay-output.schema.json',
    workflowFile: 'workflows/screen-writer.workflow.json',
    nodeId: '2f6543de-35cd-4037-b8ab-c597033128f7',
    nodeName: 'Structured Output Parser',
  },
];

async function injectSchemas(): Promise<void> {
  console.info('🔄 Injecting schemas into workflows...\n');

  for (const mapping of SCHEMA_MAPPINGS) {
    try {
      // Read schema file
      const schemaPath = path.join(process.cwd(), mapping.schemaFile);
      const schemaContent = await fs.readFile(schemaPath, 'utf-8');
      const schema = JSON.parse(schemaContent);

      // Read workflow file
      const workflowPath = path.join(process.cwd(), mapping.workflowFile);
      const workflowContent = await fs.readFile(workflowPath, 'utf-8');
      const workflow = JSON.parse(workflowContent);

      // Find the node by ID
      const node = workflow.nodes?.find((n: any) => n.id === mapping.nodeId);
      if (!node) {
        console.warn(`⚠️  Node ${mapping.nodeId} not found in ${mapping.workflowFile}`);
        continue;
      }

      // Update the schema (use inputSchema as that's what n8n uses)
      if (!node.parameters) {
        node.parameters = {};
      }
      
      // Store as stringified JSON (what n8n expects)
      const schemaString = JSON.stringify(schema, null, 2);
      node.parameters.inputSchema = schemaString;
      node.parameters.schemaType = 'manual';

      // Write back to workflow file
      const updatedWorkflow = JSON.stringify(workflow, null, 2);
      await fs.writeFile(workflowPath, updatedWorkflow + '\n', 'utf-8');

      console.info(`✅ ${path.basename(mapping.workflowFile)} - ${mapping.nodeName}`);
      console.info(`   Schema: ${path.basename(mapping.schemaFile)}\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ Failed to inject ${mapping.schemaFile}: ${message}\n`);
    }
  }

  console.info('✅ Schema injection complete');
}

injectSchemas().catch((error) => {
  console.error('Schema injection failed:', error);
  process.exitCode = 1;
});

