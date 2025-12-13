# MyloWare Roadmap

> **Planning Document**: This is a living roadmap describing project direction, priorities, and future vision. For technical explanations, see the [Explanation docs](explanation/).

> **The Path**: MyloWare → Consistent Series → Autonomous Channel → Channel Factory

**Updated**: December 2025  
**Status**: Phase 1 Hardening Complete (LangGraph + Llama Stack + Milvus)  
**Stack**: Llama Stack + LangGraph

---

## The Vision

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│   YOU: "I want a TikTok channel about a cat who explains quantum physics"   │
│                                                                              │
│                                    ▼                                         │
│                                                                              │
│                           [ CHANNEL FACTORY ]                                │
│                                                                              │
│                                    ▼                                         │
│                                                                              │
│   4-6 hours later: Channel running autonomously with consistent             │
│   character, trained LoRAs, series memory, and weekly content.              │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Current Status

```
TODAY ─────────────────────────────────────────────────────────────────────────►

  PHASE 1          HARDENING        PHASE 2           PHASE 3           PHASE 4
  Foundation       & LangGraph      Series            Autonomous        Channel
  ✅ COMPLETE      ◐ IN PROGRESS    Capability        Operation         Factory

  ~$100/mo         ~$100/mo         ~$250/mo          ~$400/mo          ~$650/mo

  DONE             NOW              +3-6 mo           +6-12 mo          +12-18 mo
```

---

## Phase 1.5: Hardening & Architecture

**Timeline**: Now → 2-4 weeks  
**Goal**: Production-ready security posture, cleaner architecture, better observability

### Recently Completed ✅

| Item                             | Description                                                  | Status  |
| -------------------------------- | ------------------------------------------------------------ | ------- |
| Safety fail-closed               | Safety checks now block on errors instead of passing         | ✅ Done |
| Webhook auth enforcement         | Webhooks require secrets in production                       | ✅ Done |
| Strict provider mode             | Health checks expose degraded mode when using fake providers | ✅ Done |
| Project-specific validators      | Extracted AISMR business logic from generic tools            | ✅ Done |
| Config-driven overlay extraction | Removed hardcoded project checks from workflow steps         | ✅ Done |

### Near-Term Priorities

| Priority | Item                            | Description                                                | Est. Effort | Status  |
| -------- | ------------------------------- | ---------------------------------------------------------- | ----------- | ------- |
| High     | LangGraph migration             | Replace orchestrator.py with state-machine workflow engine | 4-6h        | Planned |
| High     | Circuit breaker for Llama Stack | Prevent cascading failures when Llama Stack is degraded    | 2-3h        | Planned |
| Medium   | Webhook retry with backoff      | Exponential backoff for failed webhook deliveries          | 2h          | Planned |
| Medium   | Dead Letter Queue               | Store failed webhooks for replay; don't lose video jobs    | 3h          | Planned |
| Low      | Structured error codes          | Machine-readable error codes beyond HTTP status            | 2h          | Planned |
| Low      | OpenTelemetry external export   | Ship traces to external collector (Honeycomb, Datadog)     | 3h          | Planned |

### Deferred (Not Needed Yet)

| Item               | Why Deferred                                                                     |
| ------------------ | -------------------------------------------------------------------------------- |
| Redis caching      | Premature optimization; revisit if latency becomes a problem                     |
| Prometheus/Grafana | Jaeger traces sufficient for personal scale; add when running multiple instances |
| Sentry             | Structured logging with request IDs works; add when team needs alerting          |

### LangGraph Migration

**Reference**: `docs/research/llama-stack-plus-langgraph.md` | `plan.md`

The LangGraph migration will replace the current ~340-line orchestrator with a state-machine based workflow engine:

```
Current                              After LangGraph
────────────────────────────────────────────────────────────────────
orchestrator.py (340 lines)    →    langgraph/graph.py (compiled graph)
steps/*.py (manual state)      →    langgraph/nodes.py (state in TypedDict)
webhooks.py (manual resume)    →    Command(resume=...) from checkpoint
RunStatus enum polling         →    interrupt() + checkpoint history
```

**Benefits**:

- Built-in checkpointing for workflow resumption after crashes
- Native interrupt handling for HITL approval gates
- Time-travel debugging via checkpoint history
- Cleaner separation of workflow logic from infrastructure

**Trigger**: Begin migration when orchestrator.py exceeds ~400 lines or we need checkpoint persistence.

---

## Phase 1: Foundation ✅ Complete

### What We Built

```
MyloWare Today (Llama Stack Native):
├── Agent System
│   ├── Agent Factory (config-driven via YAML)
│   ├── CustomTool pattern (async, ToolResponseMessage)
│   ├── Safety shields (input_shields, output_shields)
│   ├── Sampling params (greedy strategy)
│   └── Session cleanup (conversations.delete)
│
├── RAG / Knowledge
│   ├── Milvus-Lite vector store (hybrid search)
│   ├── OpenAI embeddings (text-embedding-3-small)
│   ├── Auto-discovery/creation by name
│   ├── Batch file ingestion
│   └── builtin::rag/knowledge_search tool
│
├── Observability
│   ├── Native telemetry → Jaeger (OTLP)
│   ├── Custom events (workflow, HITL, cost)
│   ├── Structured JSON logging (structlog)
│   └── Audit trail (who did what, when)
│
├── Safety
│   ├── Llama Guard shields (content_safety)
│   ├── Pre-workflow brief validation
│   ├── Agent input/output protection
│   └── Fail-closed on safety errors ✅
│
├── Evaluation
│   ├── Benchmarks API (register, evaluate_rows)
│   ├── Scoring API (LLM-as-judge)
│   └── Datasets API (register, iterrows)
│
├── Workflow
│   ├── Orchestrator (Ideator → Producer → Editor → Publisher)
│   ├── HITL gates with telemetry
│   ├── Webhook-driven async flow
│   └── Config-driven validators & extractors ✅
│
├── Integrations
│   ├── OpenAI Sora (video generation)
│   ├── Remotion (video composition)
│   ├── TikTok (upload-post publishing)
│   └── Brave Search (web search tool)
│
└── Infrastructure
    ├── Docker Compose (llama-stack, postgres, jaeger)
    ├── PostgreSQL (runs, artifacts, feedback)
    ├── Alembic migrations
    └── Health checks with degraded mode ✅
```

### Llama Stack Alignment

| API              | Usage    | Pattern                                      |
| ---------------- | -------- | -------------------------------------------- |
| **Agents**       | ✅ Full  | `Agent()` with shields, sampling, tools      |
| **Inference**    | ✅ Full  | `chat.completions.create()`                  |
| **Vector I/O**   | ✅ Full  | Milvus-Lite hybrid search                    |
| **Files**        | ✅ Full  | Batch upload with `file_ids`                 |
| **Safety**       | ✅ Full  | `shields.register()`, `safety.run_shield()`  |
| **Telemetry**    | ✅ Full  | `telemetry.log_event()`, Jaeger export       |
| **Evaluation**   | ✅ Full  | `benchmarks.register()`, `scoring.score()`   |
| **Datasets**     | ✅ Full  | `datasets.register()`, `datasets.iterrows()` |
| **Tool Runtime** | ✅ Full  | `CustomTool`, `ToolResponseMessage`          |
| **Responses**    | ✅ Ready | `responses.create()` for single-turn         |

### Current Capabilities

| Capability                  | Status                              |
| --------------------------- | ----------------------------------- |
| Generate video ideas        | ✅ Works                            |
| Produce videos via OpenAI Sora | ✅ Works                         |
| Compose videos via Remotion | ✅ Works                            |
| Publish to TikTok           | ✅ Works                            |
| RAG knowledge retrieval     | ✅ Works (hybrid search)            |
| Safety screening            | ✅ Works (Llama Guard, fail-closed) |
| Observability               | ✅ Works (Jaeger traces)            |
| Evaluation pipeline         | ✅ Works (LLM-as-judge)             |
| Character consistency       | ❌ Limited (video generation is stochastic) |
| Series memory               | ❌ None (runs are independent)      |
| Autonomous operation        | ❌ None (human triggers everything) |

### Current Costs

| Item                | Monthly     |
| ------------------- | ----------- |
| Fly.io              | $10-20      |
| Together AI         | $20-30      |
| OpenAI Sora         | $20-50      |
| OpenAI (embeddings) | $5-10       |
| **Total**           | **$55-110** |

---

## Phase 2: Series Capability

**Timeline**: 3-6 months  
**Goal**: ONE channel with recurring characters and consistent visuals

### What Gets Built

#### Epic 6: Series Memory System

| Story                    | What It Does                                         | Llama Stack API           |
| ------------------------ | ---------------------------------------------------- | ------------------------- |
| 6.1 Character Memory     | Store character profiles (voice, appearance, traits) | Vector I/O (memory banks) |
| 6.2 World State          | Store locations, rules, recurring elements           | Vector I/O (memory banks) |
| 6.3 Episode History      | Track what happened, enable continuity queries       | Datasets API              |
| 6.4 Character Voice LoRA | Fine-tune text model on character dialogue           | Post-Training API         |
| 6.5 Continuity Agent     | Check new scripts for contradictions                 | Agents API                |

#### Epic 7: Self-Hosted Video Generation

| Story                         | What It Does                           | Llama Stack API          |
| ----------------------------- | -------------------------------------- | ------------------------ |
| 7.1 Video Gen Service         | Deploy Mochi 1 or WAN 2.2 on GPU       | Custom provider          |
| 7.2 Style LoRA                | Train for consistent visual style      | Post-Training API        |
| 7.3 Character Appearance LoRA | Train for character visual consistency | Post-Training API        |
| 7.4 Tool Integration          | Replace OpenAI Sora with self-hosted   | Tool Runtime             |
| 7.5 Vision QA                 | Auto-check frames for consistency      | Inference (vision model) |

### Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           MYLOWARE (Phase 2)                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│  Everything from Phase 1, plus:                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│  SERIES MEMORY (Llama Stack Vector I/O)                                      │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐                │
│  │ Characters      │ │ World State     │ │ Episode History │                │
│  │ memory_bank     │ │ memory_bank     │ │ dataset         │                │
│  └─────────────────┘ └─────────────────┘ └─────────────────┘                │
├─────────────────────────────────────────────────────────────────────────────┤
│  SELF-HOSTED VIDEO (Llama Stack Post-Training API)                           │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐                │
│  │ Video Gen       │ │ Style LoRA      │ │ Character LoRA  │                │
│  │ Service         │ │ (post_training) │ │ (post_training) │                │
│  └─────────────────┘ └─────────────────┘ └─────────────────┘                │
├─────────────────────────────────────────────────────────────────────────────┤
│  WORKFLOW (LangGraph)                                                        │
│  Supervisor → Ideator* → Continuity → Producer* → Editor → Publisher        │
│               uses char              uses self-hosted                        │
│               voice LoRA             video + LoRAs                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Exit Criteria

- [ ] One series with 2+ recurring characters
- [ ] 20+ episodes with consistent character voice
- [ ] Visual consistency >4.0/5.0 (vision model score)
- [ ] Self-hosted video gen operational
- [ ] OpenAI Sora costs eliminated

### Costs: ~$200-300/month

| Item                | Monthly      |
| ------------------- | ------------ |
| Fly.io              | $20-30       |
| Together AI         | $50-80       |
| Cloud GPU (RunPod)  | $100-200     |
| OpenAI (embeddings) | $5-10        |
| **Total**           | **$175-320** |

---

## Phase 3: Autonomous Operation

**Timeline**: 6-12 months after Phase 2  
**Goal**: Channel runs with minimal human oversight

### What Gets Built

#### Epic 8: Autonomous Content Loop

| Story                     | What It Does                              | Llama Stack API           |
| ------------------------- | ----------------------------------------- | ------------------------- |
| 8.1 Strategist Agent      | Plan content calendar, manage series arcs | Agents API                |
| 8.2 Analytics Integration | Pull TikTok metrics, identify winners     | Tool Runtime              |
| 8.3 Trend Monitoring      | Detect trends, suggest adaptations        | Tool Runtime (web search) |
| 8.4 Auto-Scheduler        | Queue content without manual trigger      | Agents API                |
| 8.5 Exception-Based HITL  | Only surface problems, not all content    | Safety API                |
| 8.6 DPO Training          | Learn from engagement data                | Post-Training API         |

### Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           MYLOWARE (Phase 3)                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│  Everything from Phase 2, plus:                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│  STRATEGIC LAYER (Llama Stack Agents)                                        │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐                │
│  │ Strategist      │ │ Analytics       │ │ Trend Monitor   │                │
│  │ Agent           │ │ Tool            │ │ Tool            │                │
│  └─────────────────┘ └─────────────────┘ └─────────────────┘                │
├─────────────────────────────────────────────────────────────────────────────┤
│  AUTONOMOUS LOOP                                                             │
│                                                                              │
│    Strategy → Ideas → Produce → QA → Publish → Analytics ─┐                 │
│        ▲                         │                        │                 │
│        │                    auto-pass                     │                 │
│        │                    if >4.0                       │                 │
│        │                                                  │                 │
│        └──────────── DPO training on winners ◄────────────┘                 │
│                      (post_training API)                                    │
│                                                                              │
│  Human only involved for:                                                   │
│  • Weekly strategy review (~30 min)                                         │
│  • Exception handling (quality/safety flags)                                │
│  • Monthly LoRA evaluation                                                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Exit Criteria

- [ ] Channel produces 5+ posts/week without manual trigger
- [ ] Human time <5 hours/week
- [ ] Quality maintained (engagement parity)
- [ ] DPO loop running monthly
- [ ] Exception rate <20%

### Costs: ~$350-470/month

---

## Phase 4: Channel Factory

**Timeline**: 6-12 months after Phase 3  
**Goal**: Spin up new channels from a prompt

### What Gets Built

#### Epic 9: World Builder

| Story                   | What It Does                                     | Llama Stack API         |
| ----------------------- | ------------------------------------------------ | ----------------------- |
| 9.1 Concept Expander    | Turn prompt into detailed world bible            | Agents API              |
| 9.2 Character Generator | Create characters with voice, appearance, traits | Agents API + Vector I/O |
| 9.3 Setting Generator   | Create locations and visual style guide          | Agents API              |
| 9.4 Format Designer     | Define episode structure, length, hooks          | Agents API              |

#### Epic 10: Auto LoRA Pipeline

| Story                         | What It Does                          | Llama Stack API       |
| ----------------------------- | ------------------------------------- | --------------------- |
| 10.1 Synthetic Data Generator | Create training data from world bible | Agents API + Datasets |
| 10.2 Voice LoRA Trainer       | Auto-train character voice LoRA       | Post-Training API     |
| 10.3 Visual LoRA Trainer      | Auto-train style/character LoRAs      | Post-Training API     |
| 10.4 LoRA Validator           | Verify LoRA quality before deployment | Evaluation API        |

#### Epic 11: Multi-Channel Management

| Story                        | What It Does                          | Llama Stack API      |
| ---------------------------- | ------------------------------------- | -------------------- |
| 11.1 Channel Provisioner     | Create memory banks, configure agents | Vector I/O + Agents  |
| 11.2 Multi-Channel Dashboard | Monitor all channels from one view    | Telemetry API        |
| 11.3 Channel Templates       | Pre-built configs for common formats  | Config files         |
| 11.4 Cross-Channel Analytics | Compare performance across channels   | Telemetry + Datasets |

### The Channel Factory Flow

```
INPUT: "A dog that reviews movies"

┌─────────────────────────────────────────────────────────────────────────────┐
│  STEP 1: World Builder (30 min) - Agents API                                │
│  → OUTPUT: World Bible                                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│  STEP 2: Synthetic Data (1 hour) - Agents + Datasets API                    │
│  → OUTPUT: Training datasets                                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│  STEP 3: Auto LoRA Training (2-4 hours) - Post-Training API                 │
│  → OUTPUT: 3 LoRA files                                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│  STEP 4: Channel Provisioner (10 min) - Vector I/O + Agents API             │
│  → OUTPUT: Ready-to-run config                                               │
├─────────────────────────────────────────────────────────────────────────────┤
│  STEP 5: Pilot Producer (1 hour) - Full pipeline                            │
│  → OUTPUT: 10 publish-ready videos                                           │
├─────────────────────────────────────────────────────────────────────────────┤
│  STEP 6: Launch!                                                             │
│  • Channel enters autonomous loop                                            │
│  • Joins multi-channel dashboard (Telemetry API)                             │
└─────────────────────────────────────────────────────────────────────────────┘

TOTAL: ~4-6 hours from prompt to running channel
```

### Exit Criteria

- [ ] Create new channel from concept in <6 hours
- [ ] 3+ channels running simultaneously
- [ ] Total human time <10 hours/week for all channels
- [ ] LoRA training fully automated

### Costs: ~$500-800/month

---

## Technology Stack (Llama Stack Native)

| Layer             | Technology                  | Llama Stack API   |
| ----------------- | --------------------------- | ----------------- |
| **Orchestration** | LangGraph (planned)         | Agents API        |
| **LLM Inference** | Together AI / OpenAI        | Inference API     |
| **Text LoRA**     | Fine-tuned character voices | Post-Training API |
| **Video Gen**     | OpenAI Sora → Self-hosted   | Tool Runtime      |
| **Video LoRA**    | Model-specific training     | Post-Training API |
| **Memory**        | Milvus-Lite (hybrid search) | Vector I/O API    |
| **Safety**        | Llama Guard (fail-closed)   | Safety API        |
| **Eval**          | LLM-as-judge, benchmarks    | Scoring/Eval API  |
| **Observability** | Jaeger (OTLP)               | Telemetry API     |
| **Storage**       | PostgreSQL                  | -                 |
| **Hosting**       | Fly.io + RunPod/Local GPU   | -                 |

---

## Off-Ramps

Each phase is valuable on its own. You don't have to reach Phase 4.

| Stop At        | What You Have                     | Valid If...                  |
| -------------- | --------------------------------- | ---------------------------- |
| **Phase 1** ✅ | Solid video production assistant  | Just want help making videos |
| **Phase 2**    | Consistent series with characters | ONE great channel is enough  |
| **Phase 3**    | Autonomous single channel         | Don't want more channels     |
| **Phase 4**    | Channel Factory                   | Want content empire          |

---

## Open Questions

- Which video model (Mochi vs WAN) has better LoRA support?
- TikTok API stability for automated posting?
- DPO training frequency — monthly? Weekly?
- Multi-platform (YouTube Shorts, Instagram Reels) in scope?

---

_This is a living document. Last updated: December 2024_
