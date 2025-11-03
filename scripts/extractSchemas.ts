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

async function extractSchemas(): Promise<void> {
  console.info('🔄 Extracting schemas from workflows...\n');

  for (const mapping of SCHEMA_MAPPINGS) {
    try {
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

      // Extract the schema (check both inputSchema and jsonSchema)
      const schemaString = node.parameters?.inputSchema || node.parameters?.jsonSchema;
      if (!schemaString) {
        console.warn(`⚠️  No schema found in ${mapping.nodeName} node in ${mapping.workflowFile}`);
        continue;
      }

      // Parse and format the schema
      const schema = JSON.parse(schemaString);
      const formattedSchema = JSON.stringify(schema, null, 2);

      // Write to schema file
      const schemaPath = path.join(process.cwd(), mapping.schemaFile);
      await fs.writeFile(schemaPath, formattedSchema + '\n', 'utf-8');

      console.info(`✅ ${path.basename(mapping.schemaFile)}`);
      console.info(`   From: ${path.basename(mapping.workflowFile)} - ${mapping.nodeName}\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ Failed to extract from ${mapping.workflowFile}: ${message}\n`);
    }
  }

  console.info('✅ Schema extraction complete');
}

extractSchemas().catch((error) => {
  console.error('Schema extraction failed:', error);
  process.exitCode = 1;
});

