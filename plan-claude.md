# MyloWare Alignment Plan: Bridge to North Star
**Model:** Claude Sonnet 4.5  
**Date:** 2025-01-09  
**Status:** Foundation Analysis Complete

---

## Executive Summary

### Current State Assessment

**✅ Epic 1: Trace Coordination - COMPLETE (80%)**

The foundation is **largely built** and follows the North Star vision:

- **Universal Workflow**: `myloware-agent.workflow.json` exists and implements the polymorphic pattern
- **Trace State Machine**: `execution_traces` table with `currentOwner`, `workflowStep`, `status`
- **MCP Tools**: `trace_prep`, `handoff_to_agent`, `trace_update`, `memory_search`, `memory_store`
- **Dynamic Tool Scoping**: Personas get different tools via `allowedTools` array
- **Test Coverage**: 154+ tests, 66%+ coverage, comprehensive integration tests
- **Database Schema**: Full pgvector implementation with proper indices

**⚠️ Epic 1.5: Foundation Stabilization - IN PROGRESS (50%)**

Six critical stories identified in `plan.md`:
1. **Lock Down Entry Points** - CORS open, hardcoded hosts, verbose auth logs
2. **Unblock Project Playbooks** - Loading system exists but has path issues
3. **Fix Memory Trace Filtering** - Using JSON metadata instead of indexed column
4. **Normalize trace_update Contract** - Slug vs UUID mismatch
5. **Security & Operations Runbook** - Missing production guidance
6. **Test Hygiene & Config Externalization** - ESLint ignores tests, hardcoded configs

**❌ Epic 2: Agent Workflows - NOT STARTED (0%)**

Agent handoff chain blocked until Epic 1.5 complete:
- Casey → Iggy → Riley → Veo → Alex → Quinn
- HITL approval points
- Completion notifications
- Error handling workflows

---

## Gap Analysis: Code vs North Star

### 1. Universal Workflow Pattern

| Feature | North Star | Current Implementation | Gap |
|---------|-----------|----------------------|-----|
| One workflow file | ✅ Required | ✅ `myloware-agent.workflow.json` exists | None |
| Multiple triggers | ✅ Telegram/Chat/Webhook | ✅ All three triggers present | None |
| Dynamic persona discovery | ✅ Via `trace.currentOwner` | ✅ `trace_prep` loads persona | None |
| Tool scoping | ✅ Per-persona `allowedTools` | ✅ MCP Client filters dynamically | None |
| Workflow triggers | ✅ For Veo/Alex/Quinn | ✅ `toolWorkflow` nodes with guards | None |

**Verdict:** ✅ **COMPLETE** - Universal workflow fully implements North Star pattern

---

### 2. Trace State Machine

| Feature | North Star | Current Implementation | Gap |
|---------|-----------|----------------------|-----|
| `execution_traces` table | ✅ Required | ✅ Exists with all fields | None |
| `currentOwner` | ✅ Tracks active persona | ✅ Implemented | None |
| `workflowStep` | ✅ Position in pipeline | ✅ Increments on handoff | None |
| `instructions` | ✅ Briefing for next agent | ✅ Stored and passed | None |
| `status` enum | ✅ active/completed/failed | ✅ Enum exists | None |
| Optimistic locking | ✅ Prevent race conditions | ✅ Implemented with retries | None |

**Verdict:** ✅ **COMPLETE** - State machine fully operational

---

### 3. Special Handoff Targets

| Feature | North Star | Current Implementation | Gap |
|---------|-----------|----------------------|-----|
| `toAgent: "complete"` | ✅ Marks trace completed | ⚠️ Mentioned in docs/comments | **PARTIAL** |
| `toAgent: "error"` | ✅ Marks trace failed | ⚠️ Mentioned in docs/comments | **PARTIAL** |
| No webhook on terminal | ✅ Don't invoke webhook | ⚠️ Implementation unclear | **NEEDS VERIFICATION** |
| Completion notification | ✅ Send to user via Telegram | ❌ Not implemented | **MISSING** |
| URL extraction | ✅ Parse publish URL from instructions | ❌ Not implemented | **MISSING** |

**Verdict:** ⚠️ **INCOMPLETE** - Logic mentioned but not fully implemented

**Evidence:**
```typescript
// src/utils/trace-prep.ts:408-409
'   - For Quinn: call handoff_to_agent with toAgent="complete" after publishing',
'   - If error: call handoff_to_agent with toAgent="error"'

// src/mcp/tools.ts:432 (handoff_to_agent description)
// Mentions "complete"/"error" targets but implementation unclear
```

**Required Implementation:**
```typescript
// src/mcp/tools.ts - handoff_to_agent tool
if (validated.toAgent === 'complete') {
  // 1. Update trace status to 'completed'
  await traceRepo.updateTrace(validated.traceId, {
    status: 'completed',
    completedAt: new Date(),
    currentOwner: 'complete'
  });
  
  // 2. Extract publish URL from instructions
  const urlMatch = validated.instructions.match(/https?:\/\/[^\s]+/);
  const publishUrl = urlMatch ? urlMatch[0] : null;
  
  // 3. Send Telegram notification (if sessionId starts with 'telegram:')
  if (trace.sessionId?.startsWith('telegram:')) {
    const chatId = trace.sessionId.split(':')[1];
    await sendTelegramNotification(chatId, {
      message: `🎉 Your ${projectName} video is live!`,
      url: publishUrl
    });
  }
  
  // 4. Return without invoking webhook
  return { success: true, message: 'Trace completed', terminal: true };
}

if (validated.toAgent === 'error') {
  // Mark trace failed, log error, return without webhook
  await traceRepo.updateTrace(validated.traceId, {
    status: 'failed',
    completedAt: new Date(),
    currentOwner: 'error'
  });
  
  // Log error memory
  await storeMemory({
    content: `Workflow failed: ${validated.instructions}`,
    memoryType: 'episodic',
    persona: [trace.currentOwner],
    metadata: { traceId: validated.traceId, error: true }
  });
  
  return { success: true, message: 'Trace failed', terminal: true };
}
```

---

### 4. Project Configuration

| Feature | North Star | Current Implementation | Gap |
|---------|-----------|----------------------|-----|
| `workflow` array | ✅ Defines agent pipeline | ✅ In schema, loaded by trace_prep | None |
| `optionalSteps` array | ✅ Steps that can be skipped | ✅ In schema | None |
| Project playbooks | ✅ Agent-specific instructions | ✅ `loadProjectPlaybooks()` exists | **PATH ISSUES** |
| Guardrails | ✅ Project-specific rules | ✅ Stored in JSONB | None |

**Verdict:** ⚠️ **MOSTLY COMPLETE** - Playbook loading has bugs (Epic 1.5.2)

**Current Issue (from plan.md):**
```typescript
// Story 1.5.2: Unblock Project Playbooks
// Problem: loadProjectJson tries data/projects/{slug}.json
// Reality: Project data is in DB, playbooks are in data/projects/{slug}/
// Solution: Fix path resolution in loadProjectPlaybooks()
```

---

### 5. Memory Discipline

| Feature | North Star | Current Implementation | Gap |
|---------|-----------|----------------------|-----|
| `traceId` in metadata | ✅ REQUIRED for coordination | ⚠️ JSONB field | **INEFFICIENT** |
| Tagged memories | ✅ All memories tagged | ✅ Implemented | None |
| Vector search | ✅ Semantic similarity | ✅ HNSW index | None |
| Temporal decay | ✅ Prefer recent memories | ✅ Implemented | None |
| `traceId` column | ✅ For indexed filtering | ❌ Uses JSONB instead | **PERFORMANCE GAP** |

**Verdict:** ✅ **COMPLETE** - Already using indexed `traceId` column!

**Verification:**
```typescript
// src/db/schema.ts:116
traceId: uuid('trace_id'),  // ✅ Column exists

// src/db/schema.ts:139
traceIdIdx: index('memories_trace_id_idx').on(table.traceId),  // ✅ Index exists

// src/db/repositories/memory-repository.ts:38-40
if (traceId) {
  conditions.push(eq(memories.traceId, traceId));  // ✅ Uses indexed column!
}

// src/tools/memory/searchTool.ts:36-37
if (params.traceId) {
  const traceScopedMemories = await repository.findByTraceId(params.traceId, {
    // ✅ Fast path for trace-scoped queries
```

**Discovery:** Epic 1.5.3 is **not actually an issue**. The code is already optimized!

The `plan.md` incorrectly claims this needs fixing, but the implementation already uses the indexed column instead of JSON metadata. This is a documentation issue, not a code issue.

---

### 6. MCP Tools Inventory

| Tool | North Star | Current Implementation | Status |
|------|-----------|----------------------|--------|
| `trace_prep` | ✅ One call for preprocessing | ✅ `/mcp/trace_prep` endpoint | ✅ COMPLETE |
| `trace_update` | ✅ Casey sets project | ✅ Implemented | ⚠️ CONTRACT ISSUE (1.5.4) |
| `handoff_to_agent` | ✅ Transfer ownership | ✅ Implemented | ⚠️ INCOMPLETE (no terminal) |
| `memory_search` | ✅ Find context | ✅ Implemented | ⚠️ VERIFY traceId filtering |
| `memory_store` | ✅ Save outputs | ✅ Implemented | ✅ COMPLETE |
| `workflow_trigger` | ✅ Call workflows | ✅ Implemented (Veo/Alex/Quinn) | ✅ COMPLETE |
| `jobs` | ✅ Track async work | ✅ Implemented | ✅ COMPLETE |

**Verdict:** ⚠️ **MOSTLY COMPLETE** - 3 issues to fix in Epic 1.5

---

### 7. Security & Operations

| Feature | North Star | Current Implementation | Gap |
|---------|-----------|----------------------|-----|
| CORS allowlist | ✅ Fail-closed | ❌ `['*']` in config | **CRITICAL** (1.5.1) |
| Host allowlist | ✅ Externalized | ❌ Hardcoded | **HIGH** (1.5.1) |
| Auth logging | ✅ Minimal in production | ❌ Verbose always | **MEDIUM** (1.5.1) |
| Security runbook | ✅ Required | ❌ Missing | **HIGH** (1.5.5) |
| Production runbook | ✅ Required | ❌ Missing | **HIGH** (1.5.5) |
| Deployment guide | ✅ Required | ⚠️ Basic docs exist | **MEDIUM** (1.5.5) |

**Verdict:** ⚠️ **INCOMPLETE** - Critical security gaps (Epic 1.5)

---

### 8. Testing & Quality

| Feature | North Star | Current Implementation | Gap |
|---------|-----------|----------------------|-----|
| Unit tests | ✅ ≥50% coverage (interim) | ✅ 66%+ coverage | ✅ EXCEEDS TARGET |
| Integration tests | ✅ All handoffs tested | ✅ casey→iggy→riley→veo→alex→quinn | ✅ COMPLETE |
| E2E tests | ✅ Happy path | ✅ full-aismr-happy-path.test.ts | ✅ COMPLETE |
| Legacy tool guard | ✅ CI check | ✅ `check-deprecated-tools.ts` | ✅ COMPLETE |
| ESLint on tests | ✅ No exceptions | ❌ `tests/**` ignored | **MEDIUM** (1.5.6) |
| Config externalization | ✅ All env vars | ❌ Some hardcoded | **MEDIUM** (1.5.6) |

**Verdict:** ✅ **MOSTLY COMPLETE** - Test hygiene issues (Epic 1.5.6)

---

## Critical Findings

### 1. **Epic 1 is Actually 80% Complete** ✅

The North Star architecture is **already implemented**:
- Universal workflow with polymorphic personas ✅
- Trace state machine with ownership tracking ✅
- MCP tools with dynamic scoping ✅
- Database schema with proper indices ✅
- Comprehensive test suite ✅

**Gap:** The `plan.md` says "Epic 1 Complete" but it's missing terminal handoff targets and completion notifications.

---

### 2. **Epic 1.5 is the Real Blocker** ⚠️

Six stabilization stories block production readiness:

| Story | Priority | Impact | Effort | Status |
|-------|---------|--------|--------|--------|
| 1.5.1: Security | P0 | CRITICAL | 3 pts | Not Started |
| 1.5.2: Playbooks | P0 | HIGH | 2 pts | Not Started |
| ~~1.5.3: Memory Filter~~ | ~~P1~~ | ~~MEDIUM~~ | ~~2 pts~~ | ✅ **DONE** (Already Implemented) |
| 1.5.4: trace_update | P1 | MEDIUM | 1 pt | Not Started |
| 1.5.5: Runbooks | P0 | HIGH | 5 pts | Not Started |
| 1.5.6: Test Hygiene | P2 | LOW | 2 pts | Not Started |

**Total:** ~~15~~ **13 story points**, ~2 weeks of work (saved 2 points!)

---

### 3. **Epic 2 is Ready to Start After 1.5** 🔮

The agent workflow pipeline is **architected but not executed**:

**What Exists:**
- Persona configs in `data/personas/`
- Project configs in DB with `workflow` array
- Handoff test stubs for all transitions
- Integration tests for each agent

**What's Missing:**
- Actual agent prompts that follow the workflow
- HITL approval points in workflows
- Completion notification system
- End-to-end AISMR production run

**Epic 2 Structure (from plan.md):**
```
Story 2.1: Casey → Iggy (with playbooks)
Story 2.2: Iggy → Riley
Story 2.3: Riley → Veo
Story 2.4: Veo → Alex
Story 2.5: Alex → Quinn
Story 2.6: Full E2E AISMR Happy Path
```

---

## Proposed Execution Plan

### Phase 1: Complete Epic 1 (Terminal Handoffs) - 1 week

**Goal:** Finish what Epic 1 promised before starting Epic 1.5

#### Story 1.7: Implement Terminal Handoff Targets
**Priority:** P0 (Blocks Epic 2)  
**Effort:** 3 points

**Acceptance Criteria:**
1. `handoff_to_agent({ toAgent: "complete" })` sets `trace.status = 'completed'`
2. `handoff_to_agent({ toAgent: "error" })` sets `trace.status = 'failed'`
3. Terminal handoffs do NOT invoke webhook
4. Completion handoff extracts publish URL from instructions
5. Telegram notification sent on completion (if `sessionId` starts with `telegram:`)
6. Integration test: Complete handoff flow
7. Integration test: Error handoff flow
8. E2E test: Full trace with completion notification

**Implementation:**
```typescript
// src/mcp/tools.ts - handoff_to_agent tool (lines ~600-700)

// ADD after line ~635 (after validation):
if (validated.toAgent === 'complete' || validated.toAgent === 'error') {
  const isComplete = validated.toAgent === 'complete';
  const newStatus = isComplete ? 'completed' : 'failed';
  
  // Update trace status (terminal)
  await traceRepo.updateTrace(validated.traceId, {
    status: newStatus,
    completedAt: new Date(),
    currentOwner: validated.toAgent,
    previousOwner: trace.currentOwner
  });
  
  // Store terminal memory
  await storeMemory({
    content: isComplete 
      ? `Workflow completed: ${validated.instructions}`
      : `Workflow failed: ${validated.instructions}`,
    memoryType: 'episodic',
    persona: [trace.currentOwner],
    project: trace.projectId ? [await getProjectSlug(trace.projectId)] : [],
    tags: [isComplete ? 'completion' : 'error', 'terminal'],
    metadata: {
      traceId: validated.traceId,
      terminal: true,
      status: newStatus
    }
  });
  
  // Send Telegram notification on completion
  if (isComplete && trace.sessionId?.startsWith('telegram:')) {
    try {
      const chatId = trace.sessionId.split(':')[1];
      const urlMatch = validated.instructions.match(/https?:\/\/[^\s]+/);
      const publishUrl = urlMatch ? urlMatch[0] : null;
      
      const project = trace.projectId 
        ? await projectRepo.findById(trace.projectId)
        : null;
      
      await sendTelegramMessage(chatId, {
        text: `🎉 Your ${project?.name || 'video'} is live!${publishUrl ? `\n\nWatch: ${publishUrl}` : ''}`,
        parse_mode: 'Markdown'
      });
    } catch (error) {
      logger.warn({
        msg: 'Failed to send completion notification',
        traceId: validated.traceId,
        error: String(error)
      });
    }
  }
  
  // Return without invoking webhook (terminal state)
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: true,
        message: `Trace ${newStatus}`,
        traceId: validated.traceId,
        terminal: true
      })
    }]
  };
}

// EXISTING CODE CONTINUES (normal handoff logic)
```

**New Utility:**
```typescript
// src/utils/telegram.ts (NEW FILE)
import { config } from '../config/index.js';
import { logger } from './logger.js';

export interface TelegramMessage {
  text: string;
  parse_mode?: 'Markdown' | 'HTML';
}

export async function sendTelegramMessage(
  chatId: string,
  message: TelegramMessage
): Promise<void> {
  const botToken = config.telegram?.botToken;
  if (!botToken) {
    throw new Error('Telegram bot token not configured');
  }
  
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      ...message
    })
  });
  
  if (!response.ok) {
    const error = await response.text();
    logger.error({
      msg: 'Telegram notification failed',
      chatId,
      status: response.status,
      error
    });
    throw new Error(`Telegram API error: ${response.status}`);
  }
}
```

**Config Addition:**
```typescript
// src/config/index.ts - Add to ConfigSchema
telegram: z.object({
  botToken: z.string().optional(),
  enabled: z.boolean().default(false)
}).optional()

// Add to config parsing
telegram: {
  botToken: process.env.TELEGRAM_BOT_TOKEN,
  enabled: process.env.TELEGRAM_ENABLED === 'true'
}
```

**Tests:**
```typescript
// tests/integration/terminal-handoffs.test.ts (NEW FILE)
import { describe, it, expect, beforeAll } from 'vitest';
import { handoffToAgent } from '../../src/tools/handoff';
import { traceRepo } from '../../src/db/repositories';

describe('Story 1.7: Terminal Handoff Targets', () => {
  it('should mark trace completed on toAgent=complete', async () => {
    const trace = await traceRepo.create({ /* ... */ });
    
    await handoffToAgent({
      traceId: trace.traceId,
      toAgent: 'complete',
      instructions: 'Published to https://tiktok.com/video/123'
    });
    
    const updated = await traceRepo.findByTraceId(trace.traceId);
    expect(updated.status).toBe('completed');
    expect(updated.currentOwner).toBe('complete');
    expect(updated.completedAt).toBeDefined();
  });
  
  it('should mark trace failed on toAgent=error', async () => {
    const trace = await traceRepo.create({ /* ... */ });
    
    await handoffToAgent({
      traceId: trace.traceId,
      toAgent: 'error',
      instructions: 'Content policy violation - unable to continue'
    });
    
    const updated = await traceRepo.findByTraceId(trace.traceId);
    expect(updated.status).toBe('failed');
    expect(updated.currentOwner).toBe('error');
  });
  
  it('should not invoke webhook on terminal handoff', async () => {
    // Mock webhook invocation
    const webhookSpy = vi.spyOn(webhookClient, 'invoke');
    
    await handoffToAgent({
      traceId: trace.traceId,
      toAgent: 'complete',
      instructions: 'Done'
    });
    
    expect(webhookSpy).not.toHaveBeenCalled();
  });
  
  it('should extract URL and send Telegram notification', async () => {
    const telegramSpy = vi.spyOn(telegramUtils, 'sendTelegramMessage');
    
    const trace = await traceRepo.create({
      sessionId: 'telegram:123456789',
      /* ... */
    });
    
    await handoffToAgent({
      traceId: trace.traceId,
      toAgent: 'complete',
      instructions: 'Published successfully to https://tiktok.com/@mylo/video/123'
    });
    
    expect(telegramSpy).toHaveBeenCalledWith(
      '123456789',
      expect.objectContaining({
        text: expect.stringContaining('https://tiktok.com/@mylo/video/123')
      })
    });
  });
});
```

---

### Phase 2: Epic 1.5 Stabilization - 2 weeks

**Goal:** Fix critical gaps before agent workflows

#### Week 1: Security & Playbooks (P0)
- Story 1.5.1: Lock Down Entry Points (3 pts)
- Story 1.5.2: Unblock Project Playbooks (2 pts)
- Story 1.5.5: Security & Operations Runbook (partial - 3 pts)

#### Week 2: Quality & Documentation (P1-P2)
- ~~Story 1.5.3: Fix Memory Trace Filtering~~ (ALREADY DONE)
- Story 1.5.4: Normalize trace_update Contract (1 pt)
- Story 1.5.5: Security & Operations Runbook (complete - 2 pts)
- Story 1.5.6: Test Hygiene & Config Externalization (2 pts)

**All stories already detailed in `plan.md` with pseudo code and acceptance criteria.**

---

### Phase 3: Epic 2 Agent Workflows - 3 weeks

**Goal:** Implement full agent pipeline from Casey → Quinn

#### Week 3: Casey → Iggy → Riley
- Story 2.1: Casey project selection and handoff to Iggy
- Story 2.2: Iggy idea generation with HITL approval → Riley
- Story 2.3: Riley script writing → Veo

#### Week 4: Veo → Alex → Quinn
- Story 2.4: Veo video generation → Alex
- Story 2.5: Alex editing with HITL approval → Quinn
- Story 2.6: Quinn publishing with completion notification

#### Week 5: E2E Integration & Polish
- Full AISMR happy path (candles video)
- Error handling and recovery
- Performance optimization
- Documentation updates

---

## Implementation Priorities

### P0 (Critical - Blocks Production)
1. **Story 1.7: Terminal Handoffs** - Complete Epic 1, enable completion flow
2. **Story 1.5.1: Security** - CORS open is production vulnerability
3. **Story 1.5.2: Playbooks** - Casey can't operate without guardrails
4. **Story 1.5.5: Runbooks** - Operators need deployment/security guidance

### P1 (High - Improves Stability)
5. ~~**Story 1.5.3: Memory Filtering**~~ - ✅ Already implemented correctly
6. **Story 1.5.4: trace_update Contract** - Agent reliability issue

### P2 (Medium - Quality Improvements)
7. **Story 1.5.6: Test Hygiene** - Reduce technical debt

---

## Success Metrics

### Epic 1 Complete Criteria
- [ ] Terminal handoffs (`complete`, `error`) implemented
- [ ] Telegram notifications working
- [ ] No webhook on terminal states
- [ ] Integration tests passing
- [ ] E2E test with completion notification

### Epic 1.5 Complete Criteria
- [ ] CORS fail-closed with env-based allowlist
- [ ] Project playbooks loading correctly
- [x] Memory search using indexed `traceId` column (✅ DONE)
- [ ] `trace_update` accepts slugs and UUIDs
- [ ] Security hardening guide published
- [ ] Production runbook published
- [ ] ESLint applies to all tests
- [ ] All configs externalized to env vars

### Epic 2 Complete Criteria
- [ ] Full Casey → Quinn pipeline working
- [ ] HITL approval points at Iggy and Alex
- [ ] User receives Telegram notification on completion
- [ ] Error handling with `toAgent: error`
- [ ] E2E test: "Make AISMR candles" → published TikTok
- [ ] Average workflow completion < 10 minutes

---

## Technical Debt Analysis

### High-Priority Debt (Fix in Epic 1.5)
1. **CORS open** - Security vulnerability
2. **Hardcoded hosts** - Can't deploy to new environments
3. ~~**JSONB memory filtering**~~ - ✅ Already using indexed column
4. **Test directory ignored** - Reduces regression detection

### Medium-Priority Debt (Fix in Epic 3)
5. **No advanced memory caching** - Repeated DB hits for same memories
6. **No dynamic workflow modification** - Can't adapt pipeline at runtime
7. **No workflow retry/resume** - Failed traces require manual intervention

### Low-Priority Debt (Future)
8. **No observability dashboard** - Prometheus metrics exist but no UI
9. **No multi-project concurrent traces** - One trace per user session
10. **No persona-specific retrieval blending** - All personas use same memory search logic

---

## Architecture Validation

### ✅ What's Right

1. **Universal Workflow Pattern**: Polymorphic workflow is brilliant - zero duplication, infinite personas
2. **Trace as State Machine**: Single source of truth, observable, resumable
3. **Memory-First Coordination**: Flexible, semantic, evolvable
4. **Dynamic Tool Scoping**: Security by design, least privilege
5. **Test Coverage**: 66%+ exceeds interim target, comprehensive integration tests

### ⚠️ What Needs Work

1. **Terminal Handoffs**: Mentioned everywhere but not implemented
2. **Completion Notifications**: Critical UX gap
3. **Security Posture**: Open CORS is unacceptable for production
4. **Operational Readiness**: Missing runbooks and deployment guides
5. **HITL Workflows**: No approval points in agent pipeline

### ❌ What's Missing

1. **Agent Workflow Chain**: Epic 2 not started
2. **Error Recovery**: No retry/resume logic
3. **Observability UI**: Metrics exist but no dashboard
4. **Advanced Memory**: No caching, no persona-specific blending

---

## Risk Assessment

### High Risk (Must Address)
- **Security**: Open CORS allows unauthorized access (Epic 1.5.1)
- **Playbooks**: Casey operates blind without project guardrails (Epic 1.5.2)
- **Terminal States**: No completion flow blocks user experience (Story 1.7)

### Medium Risk (Should Address)
- **Memory Performance**: Degradation at scale (Epic 1.5.3)
- **Contract Mismatch**: Agent confusion on trace_update (Epic 1.5.4)
- **No Runbooks**: Operators can't safely deploy (Epic 1.5.5)

### Low Risk (Monitor)
- **Test Hygiene**: Technical debt accumulation (Epic 1.5.6)
- **Config Hardcoding**: Deployment friction (Epic 1.5.6)

---

## Recommended Next Steps

### Immediate (This Week)
1. **Implement Story 1.7** - Terminal handoffs and completion notifications
2. **Verify memory filtering** - Check if `traceId` column is already being used
3. **Start Story 1.5.1** - Lock down CORS and hosts

### Short-Term (Next 2 Weeks)
4. Complete Epic 1.5 (Stories 1.5.1 through 1.5.6)
5. Write security hardening guide
6. Write production runbook

### Medium-Term (Next 4 Weeks)
7. Start Epic 2: Implement agent workflow chain
8. Add HITL approval points
9. E2E test full AISMR happy path

---

## Appendix: Code Quality Observations

### Positive Patterns
- ✅ Zod validation on all inputs
- ✅ Structured logging with pino
- ✅ Retry logic with exponential backoff
- ✅ Drizzle ORM with type-safe queries
- ✅ Foreign keys and check constraints
- ✅ HNSW indices for vector search
- ✅ Comprehensive test coverage

### Areas for Improvement
- ⚠️ Some configs still hardcoded (Epic 1.5.6)
- ⚠️ ESLint ignores test directory (Epic 1.5.6)
- ⚠️ No caching layer for repeated queries (Epic 3)
- ⚠️ No request throttling per session (Epic 3)

---

## Conclusion

**The foundation is solid.** MyloWare has successfully implemented 80% of the North Star vision:
- Universal workflow ✅
- Trace state machine ✅
- MCP tools ✅
- Test coverage ✅

**The gaps are clear and fixable:**
1. Finish Epic 1 (terminal handoffs) - 1 week
2. Stabilize Epic 1.5 (security, config) - 2 weeks
3. Execute Epic 2 (agent workflows) - 3 weeks

**Total time to North Star: 6 weeks of focused work.**

The architecture is fundamentally sound. No major refactoring needed. Just finish what's started and bolt on the agent workflows.

---

**Next Steps:**
1. Review this plan with PO
2. Prioritize Story 1.7 (terminal handoffs)
3. Start Epic 1.5.1 (security) in parallel
4. Schedule Epic 2 kickoff for 3 weeks from now

**Questions to Resolve:**
1. ~~Is memory search already using indexed `traceId` column?~~ ✅ **CONFIRMED: Yes, using `eq(memories.traceId, traceId)`**
2. What's the Telegram bot token configuration? (For completion notifications)
3. Who owns Epic 1.5.5 (runbooks)? (Technical writer or engineer?)
4. What's the definition of "done" for HITL approval points? (Product requirement)

**Key Discovery:**
Epic 1.5.3 is **not actually a problem**. The `plan.md` incorrectly identified memory filtering as using JSONB metadata, but the implementation correctly uses the indexed `traceId` column with a dedicated fast-path query. This saves 2 story points (2 days of work) from Epic 1.5.

---

**Document Version:** 1.0  
**Last Updated:** 2025-01-09  
**Next Review:** After Story 1.7 completion

