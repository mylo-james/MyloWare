import fs from 'fs';
import path from 'path';

const workflowDirs = ['workflows', '.'];

function removeNewlines(str: string): string {
  return str
    .replace(/\\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function formatWorkflow(filePath: string): void {
  const content = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(content);
  
  if (data.nodes && Array.isArray(data.nodes)) {
    data.nodes.forEach((node: any) => {
      if (node.parameters) {
        if (typeof node.parameters.jsonBody === 'string') {
          node.parameters.jsonBody = removeNewlines(node.parameters.jsonBody);
        }
        if (node.parameters.options?.systemMessage) {
          node.parameters.options.systemMessage = removeNewlines(
            node.parameters.options.systemMessage
          );
        }
      }
    });
  }
  
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
  console.log(`✓ Formatted: ${filePath}`);
}

workflowDirs.forEach(dir => {
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.workflow.json'));
  files.forEach(file => {
    formatWorkflow(path.join(dir, file));
  });
});

