# Runtime Memory Permissions & API Design

**Last updated:** October 31, 2025  
**Owner:** MCP Prompts Team  

---

## 1. Objectives

- Allow trusted actors to write new memories at runtime without jeopardising corpus quality or user privacy.
- Provide a clear permission model that can be enforced across MCP tools, HTTP APIs, and n8n workflows.
- Define moderation, auditing, and abuse-prevention guardrails that scale with adaptive memory features.
- Specify the `memory_add`/`memory_update`/`memory_delete` MCP tool contracts for subsequent implementation.

---

## 2. Memory Surface & Sensitivity

| Memory Type   | Examples                                            | Default Sensitivity | Write Risk Highlights                          |
| ------------- | --------------------------------------------------- | ------------------- | ---------------------------------------------- |
| Persona       | Identity, tone, capabilities of personas            | High                | Injection could change agent behaviour wildly  |
| Project       | Goals, specs, client requirements                   | Medium              | Needs freshness controls + change history      |
| Semantic      | General knowledge, workflows, best practices        | Medium              | Risk of misinformation                         |
| Procedural    | Step-by-step instructions, playbooks                | High                | Changes alter automation outcomes              |
| Episodic      | Conversation turns, user preferences, transcripts   | High (PII)          | Must enforce privacy and retention policies    |

Each write operation must record `memoryType`, `source`, and `sensitivityLevel` (`low`, `medium`, `high`) to support downstream enforcement.

---

## 3. Actors & Permission Matrix

| Actor                | Authenticate As      | Allowed Operations                                | Constraints / Notes                                                                  |
| -------------------- | -------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **System Services**  | `system`             | add/update/delete on all types                    | Requires service-to-service token + feature flag; bypasses moderation but logs audit |
| **Trusted Agents**   | `agent:<id>`         | add (persona/project/semantic/procedural), update episodic metadata | Must include task context + justification; moderation enforced; deletes disallowed |
| **User Clients**     | `user:<id>`          | add episodic (own session), request deletion      | Limited to `memoryType=episodic`; hard limit 10 writes/hour; requires consent fields |
| **Integrations**     | `integration:<id>`   | add/update project + semantic                     | API key scope restricts memory types; moderation + manual review queue              |
| **Operators**        | `operator:<email>`   | manual add/update/delete via console              | Requires MFA; actions logged for compliance                                          |

Permission checks occur in the MCP server layer before the repository call. On failure we return `errorCode="permission_denied"` with audit logging.

---

## 4. Moderation & Validation Requirements

1. **Content Moderation**
   - Run OpenAI Moderation (or configured provider) on `content` for any non-system actor.
   - Reject `violence`, `hate`, `sexual`, `self-harm`, or `malware` categories.
   - Flag borderline content for operator review (`moderationStatus = "pending_review"`).

2. **Schema Validation**
   - Maximum `content` length: 2048 UTF-8 characters.
   - Require `title` (≤120 chars) for non-episodic memories.
   - Enforce `tags` array length ≤10, each slugified `[a-z0-9-]`.
   - Reject empty strings / duplicates in lists.

3. **Metadata Sanitisation**
   - Strip HTML/JS.
  - Automatically add server-supplied metadata:
     - `createdBy`, `createdAt`, `source` (e.g., `mcp_tool`, `workflow`, `manual`).
     - `confidence` (0–1) for agent-created entries, default 0.5 if unspecified.

4. **Uniqueness Checks**
   - Deduplicate by `(memoryType, canonicalHash(content))`.
   - Allow override by operators via `force=true`.

5. **Rate Limiting**
   - Apply leaky bucket per `(actorId, memoryType)` default `5/min`, configurable.
   - Additional global limit for episodic writes `100/min` to protect DB.

---

## 5. Abuse Prevention & Incident Workflow

1. **Real-time Guards**
   - Rate limits (see §4).
   - IP reputation check for user/integration clients (blocklisted IPs denied).
   - Optional allow-list per deployment.

2. **Anomaly Detection**
   - Emit `memory_write` telemetry with fields `{actorId, memoryType, length, tags, moderationStatus, similarityMax}`.
   - Daily batch job flags:
     - High volume from single actor.
     - Spike in rejected moderation requests.
     - Similarity to existing memory >0.95 (possible duplication).

3. **Incident Response**
   - Automatic suppression: mark entries `status="quarantined"` and exclude from search.
   - Notify operator Slack channel with context + remediation link.
   - Provide rollback script `scripts/quarantineMemory.ts` (future) for deletion or restoration.

---

## 6. MCP Tool Specifications

### 6.1 `memory_add`

**Purpose:** Persist a new memory chunk in the appropriate component with embeddings + metadata.

**Input Schema (Zod pseudo)**

```ts
{
  content: z.string().min(1).max(2048),
  memoryType: z.enum(['persona', 'project', 'semantic', 'procedural', 'episodic']),
  title: z.string().trim().max(120).optional(),          // required except episodic
  summary: z.string().trim().max(280).optional(),        // auto-generated fallback
  tags: z.array(tagSchema).max(10).optional(),
  source: z.enum(['agent', 'user', 'workflow', 'system']).optional(),
  visibility: z.enum(['public', 'team', 'private']).optional().default('team'),
  metadata: z.record(z.string(), z.unknown()).optional(),
  relatedChunkIds: z.array(z.string()).max(20).optional(),
  confidence: z.number().min(0).max(1).optional(),       // required for agent writes
  force: z.boolean().optional(),                         // operator/system only
  sessionId: z.string().uuid().optional(),               // episodic context
}
```

**Response**

```ts
{
  memoryId: string,        // UUID
  memoryType: string,
  createdAt: string,       // ISO 8601
  moderationStatus: 'accepted' | 'pending_review' | 'rejected',
  embeddingQueued: boolean,
  similarityMax?: number,  // compared to nearest existing chunk
}
```

**Processing Flow**

1. Authorisation check → bail early on failure.
2. Validate + moderate input.
3. Calculate canonical hash for dedupe.
4. Persist row with `status='pending_embedding'` then enqueue background embedding job.
5. If `relatedChunkIds` provided, insert memory graph edges with `link_type='authored_with'`.

### 6.2 `memory_update`

- Inputs: `memoryId`, optional `content/title/summary/tags/metadata/visibility/confidence`.
- Require actor to match `createdBy` or hold `operator` role, unless `force=true`.
- On content change regenerate embedding + bump `version`.
- Append to `memory_change_log` table for auditing.

### 6.3 `memory_delete`

- Soft delete by setting `status='inactive'`, storing `deletedBy` & `deletedAt`.
- Only `system` or `operator` roles; agents can request deletion for own episodic entries via escalation queue.
- Cascade: mark graph edges `inactive`.

---

## 7. Storage & Indexing Notes

- `prompt_embeddings` gains columns:
  - `created_by text`, `sensitivity text`, `confidence real`, `status text`.
- Separate table `memory_additions` to track moderation outcomes + retry state.
- Episodic writes reuse `conversation_turns` table; `memory_add` for episodic will forward to existing repository API.

---

## 8. Observability & Audit

- Emit MCP telemetry event `memory_add.attempt`/`success`/`failure`.
- Store moderation decisions in `moderation_events` table with actor metadata.
- Weekly audit report summarises:
  - Totals per memory type & actor.
  - Moderation rejection rates.
  - Pending review backlog.

---

## 9. Rollout Checklist

1. Feature flag: `RUNTIME_MEMORY_ENABLED`.
2. Staging dry-run with agent writes limited to `memoryType='semantic'`.
3. Add operator review UI for `pending_review` entries.
4. Document escalation path for users requesting data deletion (GDPR compliance).

---

## 10. Open Questions

- Should episodic writes from users be summarised instead of raw logs to reduce storage?
- Do we allow cross-project writes (e.g., agent storing info for multiple projects) under single request?
- Need decision on automatic summarisation of large semantic updates before embedding.

