# Persona Prompt Updates - JSON Output Formatting

## Overview

Updated both persona prompts to explicitly instruct the AI to return pure JSON without any markdown formatting, code blocks, or explanatory text.

## Changes Made

### 1. `ideagenerator-aismr.md`

#### Output Format Section - Added CRITICAL warning:

```markdown
**CRITICAL**: You MUST respond with ONLY a valid JSON array. No markdown code blocks, no explanations, no extra text before or after the JSON.
```

#### Enhanced Output Rules:

- Must output ONLY the JSON array
- No markdown, no code blocks, no explanations
- No wrapping in ```json markers
- Response must start with `[` and end with `]`
- No comments in JSON (// is invalid)

#### Updated Contract:

- ✅ MUST: "Return ONLY the JSON array with no additional text, markdown, or formatting"
- 🚫 MUST NOT:
  - Wrap JSON in markdown code blocks
  - Add explanatory text before or after JSON
  - Include comments in JSON

### 2. `screenwriter-aismr.md`

#### Output Format Section - Changed structure:

**Before**: Returned JSON array with one object

```json
[{ "month": "...", "idea": "...", "prompt": "..." }]
```

**After**: Returns single JSON object

```json
{ "prompt": "..." }
```

#### Added CRITICAL warning:

```markdown
**CRITICAL**: You MUST respond with ONLY a valid JSON object. No markdown code blocks, no explanations, no extra text before or after the JSON.
```

#### Enhanced Output Rules:

- Must output ONLY the JSON object
- No markdown, no code blocks, no explanations
- No wrapping in ```json markers
- Response must start with `{` and end with `}`

#### Updated Contract:

- ✅ MUST:
  - Return JSON object with ONE field: {prompt: "..."}
  - Return ONLY the JSON object with no additional text, markdown, or formatting
- 🚫 MUST NOT:
  - Wrap JSON in markdown code blocks
  - Add explanatory text before or after JSON
  - Return an array when a single object is expected

## Why These Changes?

The n8n Structured Output Parser expects **pure JSON**. When AI models add:

- Markdown code blocks (```json)
- Explanatory text ("Here's the JSON:")
- Comments (// not valid JSON)

...the parser fails with "Model output doesn't fit required format" error.

These explicit instructions tell the AI exactly what format is required, reducing parsing failures significantly.

## Testing

After updating the persona prompts in your Supabase database:

1. Run the Idea Generator workflow
2. Run the Screen Writer workflow
3. Verify both return clean JSON matching the specified schemas
4. Confirm no "output doesn't fit required format" errors

## Related Files

- `/Users/mjames/Code/n8n/STRUCTURED_OUTPUT_FIX.md` - Full technical solution documentation
- `/Users/mjames/Code/n8n/workflows/idea-generator.workflow.json` - Updated workflow
- `/Users/mjames/Code/n8n/workflows/screen-writer.workflow.json` - Updated workflow
