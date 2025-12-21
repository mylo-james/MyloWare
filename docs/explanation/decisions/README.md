# Architecture Decision Records

Significant technical decisions and their rationale.

---

## Index

| ADR | Title | Status |
|-----|-------|--------|
| [0001](0001-llama-stack-foundation.md) | Llama Stack Foundation | Accepted |
| [0002](0002-remotion-video-rendering.md) | Remotion Video Rendering | Accepted |
| [0003](0003-config-driven-agents.md) | Config-Driven Agents | Accepted |
| [0004](0004-human-in-the-loop-gates.md) | Human-in-the-Loop Gates | Accepted |
| [0005](0005-webhook-callback-pattern.md) | Webhook Callbacks | Accepted |
| [0006](0006-structured-observability.md) | Structured Observability | Accepted |
| [0007](0007-render-provider-abstraction.md) | Render Provider Abstraction | Accepted |
| [0008](0008-personal-scale-philosophy.md) | Personal Scale Philosophy | Accepted |
| [0009](0009-knowledge-base-architecture.md) | Knowledge Base Architecture | Accepted |
| [0010](0010-langgraph-orchestration.md) | LangGraph Orchestration (LangGraph + Llama Stack; Milvus for retrieval, Postgres for workflow state/checkpoints/DLQ) | Accepted |
| [0011](0011-observability-and-safety.md) | Observability & Safety Defaults | Accepted |

---

## Creating a New ADR

1. Copy `0000-template.md` to `NNNN-short-name.md`
2. Fill in Context, Decision, Consequences
3. Update this index
4. Submit PR

---

## ADR Format

```markdown
# ADR-NNNN: Title

**Status**: Proposed | Accepted | Deprecated | Superseded
**Date**: YYYY-MM-DD

## Context
What is the issue? Why are we making this decision?

## Decision
What did we decide? Be specific.

## Consequences
### Positive
### Negative
### Neutral
```
