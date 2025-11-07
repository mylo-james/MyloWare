#!/usr/bin/env tsx
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

type ForbiddenPattern = {
  label: string;
  pattern: string;
  hint: string;
};

const FORBIDDEN_PATTERNS: ForbiddenPattern[] = [
  { label: 'run_state_createOrResume', pattern: '\\brun_state_createOrResume\\b', hint: 'Use trace_create + traceId metadata instead.' },
  { label: 'run_state_read', pattern: '\\brun_state_read\\b', hint: 'Use trace_create + memory_search (traceId) instead.' },
  { label: 'run_state_update', pattern: '\\brun_state_update\\b', hint: 'Use workflow_complete or trace-aware memory entries instead.' },
  { label: 'run_state_appendEvent', pattern: '\\brun_state_appendEvent\\b', hint: 'Store episodic memories linked by traceId instead.' },
  { label: 'run_state_create', pattern: '\\brun_state_create\\b', hint: 'Use trace_create instead.' },
  { label: 'run_state_get', pattern: '\\brun_state_get\\b', hint: 'Trace metadata + memory_search cover this use case.' },
  { label: 'handoff_create', pattern: '\\bhandoff_create\\b', hint: 'Use handoff_to_agent.' },
  { label: 'handoff_claim', pattern: '\\bhandoff_claim\\b', hint: 'Use handoff_to_agent + traceId discipline.' },
  { label: 'handoff_complete', pattern: '\\bhandoff_complete\\b', hint: 'Use workflow_complete.' },
  { label: 'handoff_listPending', pattern: '\\bhandoff_listPending\\b', hint: 'Use memory_search or trace queries instead.' },
  { label: 'handoff_request', pattern: '\\bhandoff_request\\b', hint: 'Use handoff_to_agent.' },
  { label: 'prompt_discover', pattern: '\\bprompt_discover\\b', hint: 'Use procedural memories + memory_search.' },
  { label: 'clarify_ask', pattern: '\\bclarify_ask\\b', hint: 'Use Telegram HITL nodes for clarifications.' },
];

const SCAN_DIRS = ['src', 'tests', 'scripts', 'workflows'];
const ALLOWED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.yml',
  '.yaml',
  '.md',
]);

const EXCLUDED_PATHS = new Set([
  // Skip the guard itself so pattern definitions do not trip the scan.
  'scripts/check-deprecated-tools.ts',
]);

const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'data',
  'coverage',
  'drizzle/meta',
  'workflows/archive', // Archived workflows retain legacy references for historical context
]);

type Violation = {
  file: string;
  line: number;
  label: string;
  hint: string;
  snippet: string;
};

const violations: Violation[] = [];

for (const dir of SCAN_DIRS) {
  walkDir(path.join(repoRoot, dir));
}

if (violations.length > 0) {
  console.error('\n🚫 Legacy tool guard failed.');
  for (const violation of violations) {
    console.error(` - ${violation.file}:${violation.line} → ${violation.label}`);
    console.error(`   Snippet: ${violation.snippet.trim()}`);
    console.error(`   Hint: ${violation.hint}`);
  }
  console.error(`\nFound ${violations.length} forbidden reference(s). Remove or replace them before pushing.`);
  process.exit(1);
}

console.log('✅ Legacy tool guard passed. No forbidden references detected.');

function walkDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    return;
  }
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const relativePath = path.relative(repoRoot, fullPath).split(path.sep).join('/');

    if (EXCLUDED_PATHS.has(relativePath)) {
      continue;
    }

    if (entry.isDirectory()) {
      const excludedDirMatch = Array.from(EXCLUDED_DIRS).some((excluded) => {
        return relativePath === excluded || relativePath.startsWith(`${excluded}/`);
      });
      if (excludedDirMatch) {
        continue;
      }
      walkDir(fullPath);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const ext = path.extname(entry.name);
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      continue;
    }

    const content = fs.readFileSync(fullPath, 'utf8');
    scanFile(relativePath, content);
  }
}

function scanFile(relativePath: string, content: string) {
  for (const { label, pattern, hint } of FORBIDDEN_PATTERNS) {
    const regex = new RegExp(pattern, 'gi');
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const line = content.slice(0, match.index).split(/\r?\n/).length;
      const snippet = content.split(/\r?\n/)[line - 1] ?? '';
      violations.push({ file: relativePath, line, label, hint, snippet });
    }
  }
}
