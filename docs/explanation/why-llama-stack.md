# Why Llama Stack: The v1 → v2 Evolution

> **Explanation**: This document explains *why* MyloWare's architecture evolved from LangChain to Llama Stack. For *how* to use Llama Stack APIs, see [Llama Stack Integration](llama-stack.md).

**TL;DR**: MyloWare v1 was built on LangChain + LangGraph. It worked, but debugging was painful. v2 rewrote the AI layer on Llama Stack for direct control, then added LangGraph back *only* for workflow orchestration.

The result: best of both worlds.

---

## The Final Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              MyloWare v2                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                     LangGraph (Orchestration)                        │   │
│   │                                                                      │   │
│   │   • State machine workflow       • Checkpointing (PostgresSaver)    │   │
│   │   • interrupt() for HITL         • Time-travel debugging            │   │
│   │   • Crash recovery               • Visual debugging (Studio)        │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                         │
│                     Calls Llama Stack inside each node                       │
│                                    ▼                                         │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                     Llama Stack (AI Operations)                      │   │
│   │                                                                      │   │
│   │   • LLM Inference (any provider) • Native safety shields            │   │
│   │   • Tool calling (JSON Schema)   • RAG / Vector I/O                 │   │
│   │   • OpenTelemetry tracing        • Provider flexibility             │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                         │
│                                    ▼                                         │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                     Resilience Layer                                 │   │
│   │                                                                      │   │
│   │   • Circuit breaker (Llama Stack) • Webhook retry + backoff         │   │
│   │   • Dead Letter Queue             • Fail-closed safety              │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## What Each Layer Provides

### Llama Stack: AI Operations

Everything that touches an LLM goes through Llama Stack:

| Capability | What Llama Stack Provides | v1 Equivalent |
|------------|---------------------------|---------------|
| **Inference** | Single SDK, swap providers via YAML | LangChain-OpenAI wrapper |
| **Tool Calling** | JSON Schema format, consistent API | 6+ formats depending on version |
| **Safety** | Native shields, fail-closed | Manual integration |
| **RAG** | Vector I/O with hybrid search | pgvector + custom code |
| **Tracing** | OpenTelemetry (open standard) | LangSmith (proprietary) |

**The value**: Direct control. When an agent fails, you're debugging your code, not framework internals.

```python
# v2: What you write
agent = Agent(client=client, model=model, instructions=instructions, tools=tools)
response = agent.create_turn(messages=[...], session_id=session_id)

# v1: What you debugged through
User message → ChatOpenAI wrapper → Agent executor → Tool wrapper → LangGraph → Checkpointer → Your code
```

### LangGraph: Workflow Orchestration

Everything about *how agents coordinate* goes through LangGraph:

| Capability | What LangGraph Provides | Without It (v2 before migration) |
|------------|-------------------------|----------------------------------|
| **State Machine** | Declarative graph definition | Imperative `continue_after_*()` functions |
| **HITL** | Native `interrupt()` | Database polling + `/approve` endpoint |
| **Checkpointing** | Automatic at every node | None — crash = lost progress |
| **Time-Travel** | Replay from any state | None — can't reproduce issues |
| **Crash Recovery** | Resume from last checkpoint | Manual recovery |

**The value**: Workflow features without AI framework baggage. LangGraph doesn't care what LLM you use inside nodes.

```python
# LangGraph orchestrates
def ideation_node(state):
    # Llama Stack does the AI
    agent = create_agent(llama_client, state["project"], "ideator")
    ideas = agent.create_turn(messages=[...])
    return {"ideas": ideas}

def approval_node(state):
    # Native HITL — no polling
    approval = interrupt({"task": "Review ideas", "ideas": state["ideas"]})
    return {"approved": approval.get("approved")}
```

### Resilience Layer: Production Reliability

Infrastructure patterns that make it production-ready:

| Pattern | What It Does | Why It Matters |
|---------|--------------|----------------|
| **Circuit Breaker** | Stops calling Llama Stack when it's degraded | Prevents cascading failures |
| **Webhook Retry** | Exponential backoff on failed deliveries | Handles transient failures |
| **Dead Letter Queue** | Stores failed webhooks for replay | Never lose a video job |
| **Fail-Closed Safety** | Errors block, not pass | Can't accidentally ship unsafe content |

---

## v1 vs v2: The Complete Comparison

### What v1 Had (LangChain + LangGraph)

```
Dependencies:
  langgraph>=0.1.19
  langgraph-checkpoint-postgres>=2.0.25
  langchain>=0.3.0
  langchain-core>=0.3.0
  langchain-openai>=0.2.0
  langchain-text-splitters>=0.3.0
  langsmith>=0.1.74
  redis>=5.0.0

Services: 2 (Gateway :8080 + Orchestrator :8090)
Tracing: LangSmith (proprietary)
```

### What v2 Has (Llama Stack + LangGraph)

```
Dependencies:
  llama-stack-client>=0.3.0
  langgraph>=0.2.0
  langgraph-checkpoint-postgres>=2.0.0

Services: 1 (FastAPI)
Tracing: OpenTelemetry → Jaeger (open standard)
```

### Feature Comparison

| Feature | v1 (LangChain) | v2 (Llama Stack + LangGraph) |
|---------|----------------|------------------------------|
| **AI Dependencies** | 7 packages | 1 package |
| **Orchestration** | LangGraph | LangGraph ✓ |
| **Checkpointing** | ✓ PostgresSaver | ✓ PostgresSaver |
| **HITL** | ✓ interrupt() | ✓ interrupt() |
| **Time-Travel** | ✓ | ✓ |
| **Services** | 2 | 1 |
| **Tracing** | LangSmith | OpenTelemetry |
| **Safety** | Manual | Native (fail-closed) |
| **Tool Format** | Version-dependent | Single JSON Schema |
| **Provider Lock-in** | OpenAI wrappers | Provider-agnostic |
| **Circuit Breaker** | ✓ | ✓ (roadmap) |
| **Webhook Retry** | ✓ | ✓ (roadmap) |
| **DLQ** | ✓ | ✓ (roadmap) |
| **Redis** | ✓ | ✗ (not needed) |
| **Prometheus** | ✓ | ✗ (Jaeger sufficient) |
| **Sentry** | ✓ | ✗ (structured logs sufficient) |

### What We Kept, What We Dropped

**Kept from v1** (valuable):
- ✓ LangGraph for orchestration
- ✓ Checkpointing
- ✓ HITL with interrupt()
- ✓ Circuit breakers
- ✓ Webhook retry
- ✓ Dead Letter Queue

**Dropped from v1** (not needed at personal scale):
- ✗ LangChain (replaced by Llama Stack)
- ✗ LangSmith (replaced by OpenTelemetry)
- ✗ Redis (rate limiting works without it)
- ✗ Prometheus/Grafana (Jaeger traces sufficient)
- ✗ Sentry (structured logs sufficient)
- ✗ Named personas (style choice)

---

## The Key Insight

v1 used LangChain as the "everything" framework — inference, tools, chains, agents, tracing. When something broke, you were debugging framework internals.

v2 separates concerns:

| Concern | Solution | Why |
|---------|----------|-----|
| **AI Operations** | Llama Stack | Direct SDK, provider-agnostic, native safety |
| **Workflow Orchestration** | LangGraph | Best-in-class state machines, HITL, checkpointing |
| **Resilience** | Custom patterns | Circuit breaker, retry, DLQ — simple, debuggable |

LangGraph is LLM-agnostic. It doesn't care what inference backend you use inside nodes. That's the key: use each tool for what it's best at.

---

## Code Comparison

### Agent Creation

```python
# v1: LangChain
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langchain.agents import create_agent

llm = ChatOpenAI(model="gpt-4")
agent = create_agent(llm, tools, prompt)

# v2: Llama Stack
from llama_stack_client.lib.agents.agent import Agent

agent = Agent(
    client=client,
    model="meta-llama/Llama-3.2-3B-Instruct",
    instructions=config["instructions"],
    tools=tools,
)
```

### Tool Definition

```python
# v1: LangChain (format changed between versions)
from langchain_core.tools import tool

@tool
def my_tool(param: str) -> str:
    """Description for the LLM."""
    return result

# v2: Llama Stack (stable JSON Schema)
class MyTool(ClientTool):
    def get_name(self) -> str:
        return "my_tool"
    
    def get_description(self) -> str:
        return "Description for the LLM"
    
    def get_input_schema(self) -> dict:
        return {"type": "object", "properties": {"param": {"type": "string"}}}
    
    async def run_impl(self, param: str) -> dict:
        return {"result": result}
```

### Workflow Orchestration

```python
# Both v1 and v2 use LangGraph for this
from langgraph.graph import StateGraph
from langgraph.types import interrupt

def ideation_node(state):
    # v1: LangChain agent inside
    # v2: Llama Stack agent inside
    agent = create_agent(...)  # Different implementation, same interface
    return {"ideas": agent.run(state["brief"])}

def approval_node(state):
    # Same in both versions
    approval = interrupt({"task": "Review ideas"})
    return {"approved": approval.get("approved")}

graph = StateGraph(WorkflowState)
graph.add_node("ideation", ideation_node)
graph.add_node("approval", approval_node)
# ...
```

---

## Summary

| Layer | v1 | v2 | v2 Value |
|-------|----|----|----------|
| **AI Framework** | LangChain | Llama Stack | Direct control, debuggable |
| **Orchestration** | LangGraph | LangGraph | Best tool for the job |
| **Tracing** | LangSmith | OpenTelemetry | Open standard, no lock-in |
| **Safety** | Manual | Native | Fail-closed, can't disable |
| **Resilience** | Full stack | Targeted | Only what's needed |

**The philosophy**: Use the right tool for each job. Don't use a "everything" framework just because it's convenient.

---

## References

- [Llama Stack Documentation](https://llama-stack.readthedocs.io/)
- [LangGraph Documentation](https://langchain-ai.github.io/langgraph/)
- [ADR-0001: Llama Stack Foundation](decisions/0001-llama-stack-foundation.md)
- [MyloWare v1.0 Commit](https://github.com/mylo-james/myloware/commit/426ef34) — original LangChain implementation
