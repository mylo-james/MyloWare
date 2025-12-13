# MyloWare

> **"Build for one user. Document for a team. Scale when the numbers say so."**  
> — [ADR-0008: Personal Scale Philosophy](docs/explanation/decisions/0008-personal-scale-philosophy.md)

A multi-agent video production system that takes a creative brief and publishes to TikTok — built on Meta's Llama Stack, with LangGraph for workflow orchestration.

---

## Why This Exists

I wanted to automate my ASMR TikTok channel. Most AI agent frameworks are either:

- **Too magical** (LangChain) — debug nightmares when things go wrong
- **Too simple** (single-prompt wrappers) — no real orchestration

So I built on **Llama Stack** directly. No abstractions hiding the AI. Config-driven agents that domain experts can tune. Fail-closed safety that can't be accidentally disabled.

**The result:** Brief in, published video out. Human approves at two gates. Everything observable.

```
"Create a calming rain ASMR video"
              ↓
	   ┌──────────────────────────────────────────┐
	   │  Ideator → Producer → Editor → Publisher │
	   │     ↓          ↓         ↓          ↓    │
	   │   Ideas     Sora     Remotion   TikTok   │
	   │     ↓                              ↓     │
	   │  [APPROVE] ──────────────────── [APPROVE]│
	   └──────────────────────────────────────────┘
              ↓
      Published to TikTok
```

---

## The Interesting Technical Decisions

### 1. Llama Stack for Agents, LangGraph for Workflows (ADR-0001)

I use LangChain and LangGraph professionally. I know them well. Here's what I learned:

**LangChain** tries to do everything — agents, chains, memory, output parsing. When something breaks, is it your prompt? The chain? The memory? The output parser? Good luck debugging that.

**LangGraph** does one thing well: state machines with checkpointing. That's exactly what I need for workflow orchestration.

```python
# Agent logic — direct Llama Stack SDK (no magic)
agent = Agent(client=client, model=model, instructions=instructions, tools=tools)
response = agent.create_turn(messages=[...], session_id=session_id)

# Workflow orchestration — LangGraph (built for this)
graph = StateGraph(VideoWorkflowState)
graph.add_node("ideation", ideation_node)
graph.add_node("production", production_node)
# ... checkpointing, interrupts, time-travel debugging
```

Use frameworks for what they're good at. Don't use them as a crutch.

### 2. Fail-Closed Safety (ADR-0011)

Most AI systems fail _open_ — if the safety check errors, the request goes through anyway. That's backwards.

Safety is **fail-closed**: if a safety check errors or times out, the request is blocked.

### 3. Webhook Race Conditions

External services (Sora for video gen, Remotion for composition) call back via webhooks. Two webhooks arriving simultaneously for the same run? That's a race.

```python
# FOR UPDATE lock prevents concurrent modifications
run = await run_repo.get_for_update_async(run_id)
```

Classic database concurrency, but easy to forget in async webhook handlers.

### 4. Config-Driven Everything

Agent prompts live in YAML, not Python. Project-specific configs inherit from shared bases.

```
data/shared/agents/ideator.yaml      # Base behavior
data/projects/aismr/agents/ideator.yaml  # ASMR-specific tuning
```

A content creator can tweak prompts without touching code. The `deep_merge()` function handles inheritance.

---

## What's Actually Here

```
	src/
	├── agents/        # Factory pattern, YAML config loading
	├── api/           # FastAPI with rate limiting, request ID propagation
	├── safety/        # Llama Guard integration, fail-closed enforcement
	├── tools/         # Custom tools: Sora, Remotion, Upload-Post
	├── workflows/     # LangGraph workflow (graph/nodes/resume)
	└── observability/ # OpenTelemetry → Jaeger, structured logging

tests/             # ~5,900 lines
├── unit/          # 44 files, property-based testing (Hypothesis)
└── integration/   # 10 files, isolated DB per test

docs/
└── explanation/decisions/  # 12 Architecture Decision Records
```

**By the numbers:**

- 12 ADRs documenting _why_ decisions were made
- 54 test files with property-based testing
- 4 agent roles (Ideator, Producer, Editor, Publisher)
- 2 human-in-the-loop approval gates
- Llama Stack for agents, LangGraph for orchestration

---

## Production Patterns

Things I'd want to see in any production AI system:

| Pattern                  | Implementation                                                              |
| ------------------------ | --------------------------------------------------------------------------- |
| **Observability**        | OpenTelemetry traces → Jaeger, structlog with request ID propagation        |
| **Repository pattern**   | Async DB sessions, `FOR UPDATE` locks for webhook handlers                  |
| **Fail-fast config**     | Pydantic validators reject bad config at startup, not runtime               |
| **Webhook security**     | HMAC-SHA256 signatures, constant-time comparison (timing attack protection) |
| **Rate limiting**        | Per-API-key limits, graceful 429 responses                                  |
| **Graceful degradation** | Health endpoints expose `degraded_mode` for monitoring                      |

---

## Quick Start

```bash
git clone https://github.com/mylo-james/myloware.git
cd myloware
pip install -e ".[dev]"

cp .env.example .env  # Add your API keys

docker compose up -d   # Postgres, Jaeger, Llama Stack
uvicorn src.api.server:app --reload

# Create a video
curl -X POST http://localhost:8000/v1/runs/start \
  -H "X-API-Key: dev-api-key" \
  -H "Content-Type: application/json" \
  -d '{"project": "aismr", "brief": "Create a video about rain"}'
```

---

## Roadmap

**Current:** Phase 1 complete — production video assistant  
**Next:** LangGraph migration for checkpoint-based workflow resumption

```
Phase 1 ✅          Phase 2             Phase 3             Phase 4
Foundation          Series Memory       Autonomous          Channel Factory
─────────────────────────────────────────────────────────────────────────
• Multi-agent       • Character         • Auto-posting      • Channels from
  orchestration       consistency       • DPO training        a prompt
• RAG knowledge     • Self-hosted       • Exception-only    • Multi-channel
• Safety shields      video gen           HITL                management
• HITL gates        • Style LoRAs       • Strategist agent  • Auto LoRA
```

Full roadmap: [docs/ROADMAP.md](docs/ROADMAP.md)

---

## Stack

| Layer             | Choice                  | Why                           |
| ----------------- | ----------------------- | ----------------------------- |
| **AI Agents**     | Llama Stack SDK         | Direct control, no magic      |
| **Orchestration** | LangGraph               | State machines, checkpointing |
| **API**           | FastAPI + Pydantic      | Type safety, async native     |
| **Database**      | PostgreSQL + SQLAlchemy | Battle-tested, async support  |
| **Vector Store**  | Milvus-Lite             | Hybrid search, embedded       |
| **Safety**        | Llama Guard             | Input/output shields          |
| **Observability** | OpenTelemetry → Jaeger  | Distributed tracing           |
| **Video Gen**     | OpenAI Sora             | API-based video generation    |
| **Composition**   | Remotion                | React-based video rendering   |

---

## Documentation

| Doc                                                    | What's There                          |
| ------------------------------------------------------ | ------------------------------------- |
| [Why Llama Stack](docs/explanation/why-llama-stack.md) | The v1 → v2 evolution, with real code |
| [Architecture](docs/explanation/architecture.md)       | System design, data flow              |
| [ADRs](docs/explanation/decisions/)                    | 12 decision records with rationale    |
| [API Reference](docs/reference/api.md)                 | Endpoint documentation                |
| [Adding Agents](docs/how-to/add-agent.md)              | Extend with new roles                 |
| [Adding Tools](docs/how-to/add-tool.md)                | Custom Llama Stack tools              |

---

## Author

**Mylo James** — AI Automation Engineer in Chicago

I've shipped production code at CVS (React/Next.js migration, JWT SSO with Epic MyChart) and WiseTech Global (Vue.js dashboards, YAML-driven component generation). Before engineering, I taught full-stack development at App Academy and built HR automations that turned week-long manual processes into single-day workflows.

I like taking messy workflows and making them simple. MyloWare is how I learn in public.

[LinkedIn](https://www.linkedin.com/in/myloj) · [Portfolio](https://github.com/mylo-james) · [Website](https://mjames.dev)

---

## License

MIT

---

<sub>Llama Stack for agents. LangGraph for workflows. The right tool for the job.</sub>
