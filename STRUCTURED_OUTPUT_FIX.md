# Structured Output Parser Fix

## Problem

The AI agents (Idea Generator and Screen Writer) were failing with "Model output doesn't fit required format" errors when using the Structured Output Parser.

## Root Cause

The AI models were not explicitly instructed to return pure JSON in the exact format expected by the Structured Output Parser. They were likely including extra text, markdown formatting, or explanations along with the JSON, causing parsing failures.

## Solution Applied

### 1. Proper JSON Schema Configuration

Both workflows now use proper JSON Schema format with:

- `schemaType: "manual"`
- `inputSchema` with complete JSON Schema definition including:
  - `type: "object"`
  - `properties` with type and description for each field
  - `required` array listing mandatory fields
  - `additionalProperties: false` to prevent extra fields

### 2. Auto-Fix Enabled

Set `autoFix: true` in both Structured Output Parser nodes. This allows the parser to attempt fixing minor formatting issues in the AI's response.

### 3. Explicit JSON Format Instructions

Added explicit instructions to the system messages in both AI agents:

**Idea Generator:**

```
IMPORTANT: You MUST respond with ONLY a valid JSON object in this exact format with no additional text, explanations, or markdown: {"month": "string", "idea": "string", "mood": "string"}. Do not include any text before or after the JSON object.
```

**Screen Writer:**

```
IMPORTANT: You MUST respond with ONLY a valid JSON object in this exact format with no additional text, explanations, or markdown: {"prompt": "string"}. Do not include any text before or after the JSON object.
```

## Files Modified

- `/Users/mjames/Code/n8n/workflows/idea-generator.workflow.json`
- `/Users/mjames/Code/n8n/workflows/screen-writer.workflow.json`
- `/Users/mjames/Code/n8n/prompts/ideagenerator-aismr.md` ⭐ **PERSONA PROMPT**
- `/Users/mjames/Code/n8n/prompts/screenwriter-aismr.md` ⭐ **PERSONA PROMPT**

## Persona Prompt Updates

Both persona prompt files have been updated with explicit JSON formatting requirements:

### Key Changes:

1. **CRITICAL section added** at the top of Output Format:

   - Must respond with ONLY valid JSON
   - No markdown code blocks
   - No explanations or extra text
   - Response must start with `{` or `[` and end with `}` or `]`

2. **Enhanced Output Rules**:

   - Explicitly forbids wrapping in ```json code blocks
   - Prohibits comments in JSON (// is invalid)
   - Requires pure JSON output only

3. **Updated Contract sections**:
   - Added explicit "Return ONLY the JSON" requirement to ✅ MUST list
   - Added prohibitions against markdown and explanatory text to 🚫 MUST NOT list

### Idea Generator Prompt:

- Returns JSON array of 12 objects: `[{month, idea, mood}, ...]`
- No markdown, no comments, pure JSON array

### Screen Writer Prompt:

- Returns JSON object (NOT array): `{prompt: "..."}`
- Prompt field contains the multi-section Sora 2 prompt as a string

## Expected Results

- AI agents will now return pure JSON without extra text
- Structured Output Parser will successfully parse the responses
- Auto-fix will handle minor formatting inconsistencies
- Workflows should run successfully without "output doesn't fit required format" errors

## Testing

1. Import the updated workflows into n8n
2. Test the Idea Generator workflow with sample input
3. Test the Screen Writer workflow with a video idea
4. Verify that both return properly formatted JSON matching the schemas

## Reference

- [n8n Structured Output Parser Common Issues](https://docs.n8n.io/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.outputparserstructured/common-issues/)
