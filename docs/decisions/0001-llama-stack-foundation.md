# ADR-0001: Llama Stack as Foundation

**Status**: Accepted
**Date**: 2025-12-06
**Authors**: MyloWare Team

## Context

Building a multi-agent video production platform requires:

- Multi-agent orchestration with tool calling
- RAG for domain knowledge retrieval
- Safety guardrails for content moderation
- Observability for debugging and optimization
- Flexibility to swap inference providers

The AI framework landscape includes LangChain, LlamaIndex, CrewAI, AutoGen, and Llama Stack among others.

## Decision

We chose **Llama Stack** as the sole AI framework foundation, with no additional AI abstraction layers (no LangChain, LangGraph, etc.).

Key integration points:

- `llama_stack_client.lib.agents.agent.Agent` for all agents
- `llama_stack_client.lib.agents.custom_tool.CustomTool` for external tools
- `client.vector_stores` API for RAG
- OpenTelemetry integration for tracing

## Consequences

### Positive

- **Single API Surface**: One unified API for inference, tools, RAG, safety, and telemetry
- **Provider Flexibility**: Swap Together AI for Ollama/vLLM without code changes
- **Native Llama Support**: Optimized for Llama models with proper prompt formatting
- **Simpler Debugging**: No framework layers to debug through
- **Meta Investment**: Backed by Meta with active development

### Negative

- **Ecosystem Size**: Smaller ecosystem than LangChain (fewer integrations)
- **Documentation**: Less community content and tutorials
- **Breaking Changes**: API evolving faster than mature frameworks

### Neutral

- Learning curve is similar to other agent frameworks
- Migration path exists if we need to change later (tools are portable)

## Alternatives Considered

### Alternative 1: LangChain/LangGraph

**Rejected because**:

- Adds abstraction layer on top of Llama Stack
- "Framework on framework" anti-pattern
- LangChain's complexity not needed for our use case
- Debugging through multiple abstraction layers is painful

### Alternative 2: CrewAI

**Rejected because**:

- Also builds on LangChain
- More opinionated workflow model than we need
- Less control over individual agent behavior

### Alternative 3: Direct API Calls (No Framework)

**Rejected because**:

- Reinventing agent loop, tool execution, RAG
- No benefit over Llama Stack which provides these natively
- More maintenance burden

## References

- [Llama Stack Documentation](https://github.com/meta-llama/llama-stack)
- [Llama Stack Architecture](https://llama-stack.readthedocs.io/en/latest/concepts/architecture.html)
- [LangChain Complexity Discussion](https://news.ycombinator.com/item?id=37568975)
