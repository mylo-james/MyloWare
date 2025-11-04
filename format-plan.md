# Format Plan: Remove `\n` Newlines from JSON/JavaScript Strings

## Overview

Remove all embedded newline characters (`\n`) from JSON and JavaScript strings in workflow files. These are being read by machines and don't need human-readable formatting. Single-line formatting will:
- Reduce visual noise
- Simplify diffs
- Maintain identical functionality (machines parse the same way)

## Scope Summary

**Total Files**: 9 workflow JSON files
**Total Occurrences**: 19+ embedded `\n` patterns

## Affected Files & Line Counts

### Workflows Directory

1. **workflows/generate-ideas.workflow.json** - 2 occurrences
   - Line 37: `jsonBody` for video creation API call
   - Line 165: `jsonBody` for failed workflow run update

2. **workflows/generate-video.workflow.json** - 4 occurrences
   - Line 118: `jsonBody` for successful video generation workflow update
   - Line 144: `jsonBody` for Sora API video generation request
   - Line 339: `jsonBody` for failed video generation workflow update
   - Line 365: `jsonBody` for in-progress video generation workflow update

3. **workflows/aismr.workflow.json** - 3 occurrences
   - Line 138: `jsonBody` for workflow run creation
   - Line 203: `jsonBody` for failed AISMR workflow update
   - Line 746: `jsonBody` for workflow completion update

4. **workflows/screen-writer.workflow.json** - 2 occurrences
   - Line 35: `jsonBody` for screenplay workflow update
   - Line 121: `jsonBody` for failed screenplay workflow update

5. **workflows/edit-aismr.workflow.json** - 2 occurrences
   - Line 35: `jsonBody` for edit workflow update
   - Line 121: `jsonBody` for failed edit workflow update

6. **workflows/upload-to-tiktok.workflow.json** - 3 occurrences
   - Line 71: `jsonBody` for successful TikTok upload workflow update
   - Line 108: `jsonBody` for failed TikTok upload workflow update
   - Line 151: `systemMessage` for AI agent with multi-line template

7. **workflows/upload-file-to-google-drive.workflow.json** - 1 occurrence
   - Line 201: `jsonBody` for successful Google Drive upload workflow update

8. **workflows/mylo-mcp-bot.workflow.json** - 1 occurrence
   - Line 13: `systemMessage` for AI agent orchestrator (very long system prompt)

9. **mylo-mcp-agent.workflow.json** - 1 occurrence
   - Line 13: `systemMessage` for MCP agent orchestrator (very long system prompt)

## Pattern Types to Remove

### Type 1: Simple JSON Objects with `\n` (Most Common)
```json
"jsonBody": "={{ ({\n  status: 'running',\n  currentStage: 'screenplay'\n}) }}"
```

**Should become:**
```json
"jsonBody": "={{ ({ status: 'running', currentStage: 'screenplay' }) }}"
```

### Type 2: Complex Multi-line Expressions
```json
"jsonBody": "={{ ({\n  stages: {\n    idea_generation: {\n      status: 'completed',\n      output: $json.ideas\n    }\n  }\n}) }}"
```

**Should become:**
```json
"jsonBody": "={{ ({ stages: { idea_generation: { status: 'completed', output: $json.ideas } } }) }}"
```

### Type 3: JavaScript Functions with `\n`
```json
"jsonBody": "={{ (() => {\n  const run = $('Get a row').item?.json ?? {};\n  return { status: 'completed' };\n})() }}"
```

**Should become:**
```json
"jsonBody": "={{ (() => { const run = $('Get a row').item?.json ?? {}; return { status: 'completed' }; })() }}"
```

### Type 4: Long System Messages with `\n`
```json
"systemMessage": "=You are an AI.\n\nFollow these steps:\n1. First step\n2. Second step"
```

**Should become:**
```json
"systemMessage": "=You are an AI. Follow these steps: 1. First step 2. Second step"
```

## Implementation Strategy

### Phase 1: Automated Replacement (Recommended)
Create a script that:
1. Reads each workflow JSON file
2. Finds all `"jsonBody"` and `"systemMessage"` fields
3. Replaces `\n` with a single space (or no space where appropriate)
4. Removes excessive spacing (multiple spaces → single space)
5. Writes back formatted JSON

### Phase 2: Manual Review (Critical Files)
Review these files manually after automated changes:
- `mylo-mcp-bot.workflow.json` - Complex orchestration logic
- `mylo-mcp-agent.workflow.json` - Complex orchestration logic
- `workflows/upload-to-tiktok.workflow.json` - Complex IIFE patterns

### Phase 3: Testing
After formatting:
1. Validate all JSON syntax using `jq` or similar
2. Test each workflow in n8n to ensure functionality is preserved
3. Check git diff to confirm only whitespace changes

## Implementation Options

### Option A: Simple Find & Replace Script (TypeScript)
```typescript
// scripts/formatWorkflows.ts
import fs from 'fs';
import path from 'path';

const workflowDirs = [
  'workflows',
  '.'  // For mylo-mcp-agent.workflow.json
];

function removeNewlines(str: string): string {
  // Remove \n and excessive whitespace
  return str
    .replace(/\\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function formatWorkflow(filePath: string): void {
  const content = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(content);
  
  // Process nodes
  if (data.nodes && Array.isArray(data.nodes)) {
    data.nodes.forEach((node: any) => {
      if (node.parameters) {
        // Format jsonBody
        if (typeof node.parameters.jsonBody === 'string') {
          node.parameters.jsonBody = removeNewlines(node.parameters.jsonBody);
        }
        // Format systemMessage
        if (node.parameters.options?.systemMessage) {
          node.parameters.options.systemMessage = removeNewlines(
            node.parameters.options.systemMessage
          );
        }
      }
    });
  }
  
  // Write back with 2-space indentation
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
  console.log(`✓ Formatted: ${filePath}`);
}

// Run
workflowDirs.forEach(dir => {
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.workflow.json'));
  files.forEach(file => {
    formatWorkflow(path.join(dir, file));
  });
});
```

### Option B: Manual sed/awk Commands
For each file, run:
```bash
# Backup first
cp workflows/generate-ideas.workflow.json workflows/generate-ideas.workflow.json.bak

# Replace \n with space (careful with escaping)
sed -i '' 's/\\n/ /g' workflows/generate-ideas.workflow.json

# Clean up multiple spaces
sed -i '' 's/  \+/ /g' workflows/generate-ideas.workflow.json
```

### Option C: VS Code Regex Find & Replace
1. Open workspace folder
2. Use regex find: `(jsonBody|systemMessage)[^}]*\\n`
3. Manually replace each occurrence

## Recommended Approach

**Use Option A (TypeScript Script)** because:
- ✅ Safer - Validates JSON before/after
- ✅ Consistent - Same logic applied to all files
- ✅ Reversible - Can keep backups
- ✅ Auditable - See exactly what changed in git diff
- ✅ Repeatable - Can run again if needed

## Rollout Plan

### Step 1: Create Script
```bash
# Create the formatting script
touch scripts/formatWorkflows.ts
```

### Step 2: Test on Single File
```bash
# Test on one workflow first
node scripts/formatWorkflows.ts --file workflows/generate-ideas.workflow.json --dry-run
```

### Step 3: Format All Files
```bash
# Run on all workflows
npm run format:workflows
# or
tsx scripts/formatWorkflows.ts
```

### Step 4: Verify Changes
```bash
# Check JSON is valid
jq empty workflows/*.workflow.json

# Review diff
git diff workflows/

# Test critical workflows in n8n
```

### Step 5: Commit
```bash
git add -A
git commit -m "Format workflows: remove embedded newlines from JSON/JS strings

- Remove \n characters from jsonBody and systemMessage fields
- Single-line formatting for machine-readable strings
- No functional changes, only whitespace formatting
- Affects 9 workflow files with 19+ occurrences"
```

## Success Criteria

- [ ] All 19+ `\n` occurrences removed from workflow files
- [ ] All JSON files remain valid (pass `jq` validation)
- [ ] No functional changes to workflows (test in n8n)
- [ ] Git diff shows only whitespace changes in affected strings
- [ ] Code committed to phase-1 branch

## Edge Cases & Considerations

### Preserve String Literals
Be careful with actual user-facing strings that might need newlines:
```javascript
// This should NOT be changed (if it exists in display text)
"displayText": "Line 1\nLine 2"  // Keep if shown to user
```

### Escape Sequences in Prompts
Some prompts might use `\n` for specific formatting in AI responses. Review:
- System messages for AI agents
- Prompt templates
- Error messages

### Very Long Lines
After formatting, some lines may be very long (2000+ chars). This is acceptable since:
- JSON parsers don't care
- n8n reads it fine
- It's better than visual noise of `\n`

## Notes

- All changes are whitespace-only; no logic modification
- This improves maintainability and reduces diff noise
- Future workflow exports from n8n may re-introduce `\n` - consider running this script after imports
- Consider adding this to a pre-commit hook or CI check

## Estimated Time

- Script creation: 15-30 minutes
- Testing: 15 minutes
- Review & commit: 10 minutes
- **Total: ~1 hour**

