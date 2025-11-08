# Workflow Review — 2025-11-08

## Cross-Cutting Findings

- **Critical – workflow IDs are out of sync with the mapping system.** The universal workflow still hard-codes legacy n8n IDs (for example `9bJoXKRxCLs0B0Ww` and `ZzHQ2hTTYcdwN63q`), but the freshly exported sub-workflows now have different IDs (`z34mb3qsWQfoiWVD`, `PQsePXjhfSVfw6zb`). Because the mappings documented in `docs/n8n-workflow-mappings.md` require us to resolve IDs at runtime, every tool call that relies on these constants will fail until we update both the mappings and the workflow to call `workflow_resolve`.

  ```64:68:docs/n8n-workflow-mappings.md

  ```

- `upload-google-drive` → `zvJoSOEUDr9hXOLV`
- `upload-tiktok` → `uIWB6d8OslTpJl1G`
- `shotstack-edit` → `9bJoXKRxCLs0B0Ww`
- `generate-video` → `ZzHQ2hTTYcdwN63q`

  ```

  ```

- **High – deterministic tool workflows must stay deterministic.** `workflows/README.md` calls out that the sub-workflows should be revived as deterministic helpers, yet `upload-to-tiktok.workflow.json` now embeds a LangChain agent and other dynamic behavior. We need to strip agents out of tool workflows and keep all reasoning inside the universal persona flow.

  ```66:68:workflows/README.md

  ```

- Bolt on the HITL Send-and-Wait nodes for Iggy and Alex once their personas are migrated into the universal workflow.
- Revive the deterministic sub-workflows (`generate-video`, `edit-aismr`) and expose them via MCP `toolWorkflow` calls for Veo/Alex fan-out steps.

  ```

  ```

- **Medium – several workflows still rely on bespoke code when standard nodes exist.** The universal workflow uses a Code node for normalization even though the North Star pattern prescribes an Edit Fields node for trace-safe input handling.

  ```25:67:docs/UNIVERSAL_WORKFLOW.md

  ```

### 3-Node Pattern

┌─────────────────────────────────────┐
│ 1. EDIT FIELDS NODE │
│ 2. TRACE_PREP (HTTP Request) │
│ 3. AI AGENT NODE │
└─────────────────────────────────────┘

````

---

## `workflows/myloware-agent.workflow.json`

- **Critical – stale toolWorkflow IDs.** The Shotstack and Generate Video tools still point to the pre-export IDs, so the agent cannot invoke the refreshed workflows.
```182:214:workflows/myloware-agent.workflow.json
      "workflowId": {
        "__rl": true,
        "value": "9bJoXKRxCLs0B0Ww",
        "mode": "list",
        "cachedResultName": "Edit_AISMR"
      },
````

```228:258:workflows/myloware-agent.workflow.json
      "workflowId": {
        "__rl": true,
        "value": "ZzHQ2hTTYcdwN63q",
        "mode": "list",
        "cachedResultName": "Generate Video"
      },
```

```1:8:workflows/edit-aismr.workflow.json
"id": "z34mb3qsWQfoiWVD",
"name": "Edit_AISMR",
```

```1:8:workflows/generate-video.workflow.json
"id": "PQsePXjhfSVfw6zb",
"name": "Generate Video",
```

**Recommendation:** Replace the hard-coded IDs with a `workflow_resolve` call (per the mapping documentation) and update the mappings so the new IDs propagate to MCP tools.

- **Critical – guardrail violations are never stored.** The HTTP node meant to persist guardrail violations does not send a body, so every request is empty.
  ```349:368:workflows/myloware-agent.workflow.json
      "sendBody": "json",
      "options": {
        "timeout": 10000
      }
  ```

````
  **Recommendation:** Add a `jsonBody` that forwards `item.json.violationData` from the preceding Code node, and enable `continueOnFail` so logging cannot break the main flow.

- **High – input normalization still uses a Code node.** This breaks the documented 3-node pattern, makes validation harder to audit, and increases the risk of regressions when trigger payloads change.
  ```272:281:workflows/myloware-agent.workflow.json
      "type": "n8n-nodes-base.code",
      "name": "Prepare Input",
      "notes": "Normalizes and validates inbound payloads from all triggers into a single schema { traceId, sessionId, source, message }."
````

**Recommendation:** Replace this Code node with the Edit Fields configuration from `docs/UNIVERSAL_WORKFLOW.md` so all triggers share the same declarative transform.

- **High – tool guardrails filter on display names.** `trace_prep` returns tool identifiers (e.g., `handoff_to_agent`), but the guardrail filter looks for display labels such as `"Tool: Send Telegram Message"`, so it never removes disallowed tools.
  ```328:336:workflows/myloware-agent.workflow.json
  const restricted = new Set(['Tool: Send Telegram Message', 'Tool: Telegram HITL (Human-in-the-Loop)']);
  item.json.allowedTools = allowedTools.filter((tool) => {
    if (typeof tool === 'string') {
      return !restricted.has(tool);
    }
  ```
  **Recommendation:** Compare against the tool identifiers returned by `trace_prep.allowedTools` and move persona-specific filtering into the MCP layer where we already scope tools per persona.

## `workflows/error-handler.workflow.json`

- **Critical – MCP calls lack payloads.** Both HTTP nodes omit the JSON body, so neither the trace update nor the memory write executes.

  ```54:107:workflows/error-handler.workflow.json
        "sendBody": "json",
        "options": {
          "timeout": 30000
        }
      },
      "name": "Update Trace Status",
  ...
        "sendBody": "json",
        "options": {
          "timeout": 30000
        }
      },
      "name": "Store Error Memory",
  ```

  **Recommendation:** Send explicit tool payloads (e.g., `{"tool":"trace_update",...}` and `{"tool":"memory_store",...}`) and include the captured trace metadata so the failure path matches North Star observability expectations.

- **High – error routing stops at logging when no traceId is present.** We never persist the error when the trace lookup fails. Capture the minimal data (workflow, node, message) in memory so we do not lose incidents initiated outside a trace.

## `workflows/mcp-health-check.workflow.json`

- **High – placeholder Telegram chat ID.** The alert node still contains `REPLACE_WITH_TELEGRAM_ADMIN_CHAT_ID`, so alerts will fail at runtime.

  ```68:86:workflows/mcp-health-check.workflow.json
        "chatId": "={{ 'REPLACE_WITH_TELEGRAM_ADMIN_CHAT_ID' }}",
        "text": "={{ `🚨 MCP Server Health Check Failed!\n\nStatus: ${$json.statusCode}\nTime: ${new Date().toISOString()}\n\nPlease check the MCP server immediately.` }}",
  ```

  **Recommendation:** Resolve the admin channel dynamically (env var or credentials) and add a guard so the workflow fails fast if the chat ID is missing.

- **Medium – duplicate timestamps.** The JSON body calls `new Date().toISOString()` twice, yielding slightly different times. Cache a single timestamp before building the payload for easier comparison in observability.

## `workflows/generate-video.workflow.json`

- **Critical – workflow ID mismatch with the universal flow.** The universal workflow still references `ZzHQ2hTTYcdwN63q`, but the current export carries ID `PQsePXjhfSVfw6zb`. Agents will receive a 404 when they try to spawn this tool.

  ```228:234:workflows/myloware-agent.workflow.json
          "value": "ZzHQ2hTTYcdwN63q",
  ```

  ```1:6:workflows/generate-video.workflow.json
  "id": "PQsePXjhfSVfw6zb",
  "name": "Generate Video",
  ```

  **Recommendation:** Update the workflow mapping and switch to `workflow_resolve` before invoking the tool.

- **High – staging logic assumes legacy run schema.** Several nodes patch `run.stages` with hard-coded fields (`idea_generation`, `screenplay`, `video_generation`, `publishing`). Confirm these match the latest schema before we spend time wiring queue mode; otherwise the run tracker will drift.

## `workflows/edit-aismr.workflow.json`

- **Critical – workflow ID drift.** The universal flow still points at `9bJoXKRxCLs0B0Ww`, but the exported edit workflow now has ID `z34mb3qsWQfoiWVD`.

  ```182:188:workflows/myloware-agent.workflow.json
          "value": "9bJoXKRxCLs0B0Ww",
  ```

  ```1:6:workflows/edit-aismr.workflow.json
  "id": "z34mb3qsWQfoiWVD",
  ```

  **Recommendation:** Same as above—refresh the mapping and use `workflow_resolve`.

- **High – heavy inline Shotstack templating.** The Code node spans hundreds of lines and mixes business logic with vendor-specific payload building. Consider moving this logic to a version-controlled module or at least splitting out helpers so we can unit test transitions outside n8n.

- **Medium – wait loop sleeps for seven seconds.** Shotstack renders can take significantly longer than seven seconds; we should poll with exponential backoff or respect the job status returned by the API to avoid premature failures.

## `workflows/upload-file-to-google-drive.workflow.json`

- **High – required inputs are missing.** The workflow trigger only declares `runId`, yet downstream nodes expect `projectName` to exist, which leads to folder names like `undefined_2025-11-08`.

  ```10:26:workflows/upload-file-to-google-drive.workflow.json
        "workflowInputs": {
          "values": [
            {
              "name": "runId"
            }
          ]
        }
      },
      "name": "When Called by Generate Video",
  ```

  ```129:174:workflows/upload-file-to-google-drive.workflow.json
  "name": "={{ $('When Called by Generate Video').item.json.projectName }}_{{ $now.format('yyyy-MM-dd') }}",
  ```

  **Recommendation:** Extend the schema to include `projectSlug` (or lookup the slug from the run) before creating folders, and validate inputs at the trigger to fail fast.

- **Medium – downloading the wrong asset.** The workflow fetches `video_output.videoUrl`, but after Alex finishes editing the canonical asset lives under `publishing.output.editUrl`. We risk re-uploading the raw Veo clip.
  ```221:240:workflows/upload-file-to-google-drive.workflow.json
        "url": "={{ $('Get a row').item.json.video_output?.videoUrl || $('Get a row').item.json.result || '' }}",
  ```
  **Recommendation:** Prefer `publishing` output when present, and only fall back to the video generation URL when the edit stage has not run.

## `workflows/upload-to-tiktok.workflow.json`

- **Critical – tool workflow contains a LangChain agent.** Tool workflows are supposed to be deterministic, but this workflow spins up an agent, calls into a separate persona loader, and makes open-ended tool calls.

  ```146:232:workflows/upload-to-tiktok.workflow.json
      "type": "@n8n/n8n-nodes-langchain.agent",
      "name": "AI Agent",
  ...
      "type": "n8n-nodes-base.executeWorkflow",
      "name": "Call 'Load Persona'"
  ```

  **Recommendation:** Move caption generation back into the Quinn persona (via MCP tools) or convert it into a deterministic transformer that accepts structured inputs, so the publishing workflow only handles upload mechanics.

- **High – dependency on non-versioned workflow.** The `Call 'Load Persona'` node references workflow ID `4eaPRf4DiHKOvOrc`, but that workflow is not present in the repository, making the setup impossible to reproduce.

  ```189:218:workflows/upload-to-tiktok.workflow.json
        "workflowId": {
          "__rl": true,
          "value": "4eaPRf4DiHKOvOrc",
          "cachedResultName": "Load Persona"
        },
  ```

  **Recommendation:** Export the helper workflow into `workflows/` and register it through the mapping system, or replace it with an MCP tool call that already exists in the codebase.

- **Medium – upload request assumes binary property `data`.** Confirm the preceding HTTP node still emits `binary.data`; otherwise the upload call will post an empty file. Consider renaming the property to make the contract explicit.

---

## Next Steps

1. Refresh the workflow mapping table and update the universal workflow to resolve IDs dynamically before calling any tool workflows.
2. Refactor `myloware-agent.workflow.json` to follow the documented Edit Fields → trace_prep → agent pattern, while fixing guardrail telemetry.
3. Strip agents and persona-loading logic out of the TikTok upload workflow and turn caption generation into an MCP tool or a pre-step inside Quinn.
4. Patch the error handler so it actually marks traces as failed and logs the errors through MCP, then backfill guardrail and error memories for observability.
5. Audit tool workflow inputs (Drive upload, TikTok upload) so they pull everything they need from `workflow_resolve` and the workflow-run payload instead of relying on undefined fields.

Addressing these items will bring the workflows back in line with the North Star architecture and prevent runtime failures in the next production handoff.
