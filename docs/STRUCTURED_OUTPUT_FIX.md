# Structured Output Parser Status – Oct 26, 2025

We do not need why. I never wanted a why column. We just need vibe.

The n8n Structured Output Parser nodes keep our AI agents from emitting malformed JSON, but two agents are still running with the default `jsonSchemaExample` config instead of explicit schemas + `autoFix`. This document tracks the real state of each workflow and the work required to ship the hardened version.

## Current State

| Workflow                                 | Node                                                                   | Parser Config                                                  | Notes                                                                                                                                                    |
| ---------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workflows/idea-generator.workflow.json` | "Structured Output Parser" (id `86175964-7f37-435a-9aea-af0af9df2cf3`) | Uses `jsonSchemaExample` only (`idea`, `userIdea`, `vibe`)     | The persona prompt still promises a `why` field and strict JSON-only output, but the parser neither validates that field nor enforces array length = 12. |
| `workflows/screen-writer.workflow.json`  | "Structured Output Parser" feeding the Screen Writer agent             | Also driven by `jsonSchemaExample`; no manual schema or fix-up | Failures surface as generic "Model output doesn't fit required format" errors without context.                                                           |

No parser currently enables `autoFix`, so a single trailing comma or missing quote bubbles all the way up to a run failure.

## Target Behavior

1. **Explicit JSON Schema** – Define the expected shape (`type`, `items`, `required`, string length constraints) directly in the parser node instead of relying on an example blob.
2. **`autoFix` enabled** – Allow n8n to repair common issues (capitalized keys, stray prose) before surfacing an error.
3. **Descriptive errors** – Populate the `onError` path with actionable messages (e.g., "Idea 7 missing `why`") so the orchestration workflow can mark the run as `failed` instead of hanging.
4. **Schema parity with prompts** – Keep the schema in sync with the Markdown contract (Idea Generator must emit `idea`, `userIdea`, `vibe`, `why`).

## Implementation Checklist

- [ ] Update `workflows/idea-generator.workflow.json`
  - Replace `jsonSchemaExample` with a manual schema that enforces an array of exactly 12 objects.
  - Require the four keys listed above and limit `idea`/`userIdea` to short Title Cased strings.
  - Enable `autoFix` with a max retry of 2.
- [ ] Update `workflows/screen-writer.workflow.json`
  - Define the expected screenplay structure (prompt, narration cues, audio bed, etc.).
  - Wire the parser's error output to the `On Error` branch so failed parses update `videos.status` to `failed`.
- [ ] Extend `scripts/test-prompts.js` (or a new workflow test) to assert that the parser schemas contain the required fields so documentation and workflows stay aligned.

## Validation Steps

1. Run the Idea Generator workflow with a pinned input and confirm the parser rejects payloads missing `why`.
2. Introduce a deliberate formatting error (extra prose) and confirm `autoFix` resolves it without manual retries.
3. Repeat for the Screen Writer workflow, ensuring failed parses mark the associated video row as `failed`.

Keeping this file accurate prevents a repeat of the "docs say it's fixed, workflows disagree" gap noted in the latest review.
