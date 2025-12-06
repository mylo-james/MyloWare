# Llama Stack Integration Guide

This document explains how MyloWare leverages Llama Stack as its foundation.

## Why Llama Stack?

MyloWare is built **entirely** on Llama Stack's unified API. No LangChain, no LangGraph, no additional AI frameworks—just Llama Stack.

### Benefits

1. **Unified API**: One client for inference, tools, RAG, safety, telemetry, and evaluation
2. **Provider Flexibility**: Swap Together AI for local Ollama without code changes
3. **Built-in Safety**: Llama Guard shields on every agent input/output
4. **Native Observability**: Trace correlation across all agent turns
5. **Production Ready**: Battle-tested APIs with consistent behavior

## Distribution Configuration

MyloWare's Llama Stack configuration lives in `llama_stack/run.yaml`. Here's what each section does:

### Inference Provider

```yaml
inference:
  - provider_id: together
    provider_type: remote::together
    config:
      api_key: ${env.TOGETHER_API_KEY}
```

We use Together AI for inference. To switch to local Ollama:

```yaml
inference:
  - provider_id: ollama
    provider_type: remote::ollama
    config:
      host: http://localhost:11434
```

### Models

```yaml
models:
  - model_id: meta-llama/Llama-3.2-3B-Instruct
    provider_id: together
    
  - model_id: meta-llama/Llama-Guard-3-8B
    provider_id: together
```

All agents use `Llama-3.2-3B-Instruct` by default. Llama Guard is used for safety shields.

### Safety Shields

```yaml
safety:
  - provider_id: llama-guard
    provider_type: inline::llama-guard
    config:
      model: meta-llama/Llama-Guard-3-8B

shields:
  - shield_id: llama_guard
    provider_id: llama-guard
```

Every agent has input and output shields:

```python
agent = Agent(
    client=client,
    model="meta-llama/Llama-3.2-3B-Instruct",
    instructions="...",
    input_shields=["llama_guard"],   # Filters harmful inputs
    output_shields=["llama_guard"],  # Filters harmful outputs
)
```

### Vector I/O (RAG)

```yaml
vector_io:
  - provider_id: faiss
    provider_type: inline::faiss
    config:
      embedding_model: all-MiniLM-L6-v2
      embedding_dimension: 384

vector_dbs:
  - vector_db_id: myloware-knowledge
    provider_id: faiss
```

Knowledge base documents are ingested and queried via `builtin::rag/knowledge_search`:

```python
# Agent with RAG
agent = create_agent(
    client=client,
    project="aismr",
    role="ideator",
    vector_db_id="myloware-knowledge",  # Injects RAG tool
)
```

### Memory Banks

```yaml
memory:
  - provider_id: faiss
    provider_type: inline::faiss

memory_banks:
  - memory_bank_id: user-preferences
    provider_id: faiss
```

The Supervisor agent uses memory to recall user preferences:

```python
# Supervisor has memory tool
tools = [
    ...,
    {
        "name": "builtin::memory/query",
        "args": {"memory_bank_ids": ["user-preferences"]},
    },
]
```

### Tools

```yaml
tools:
  # Web search for ideation
  # Web search provided by Together distribution (builtin::websearch)

  # RAG knowledge search
  - tool_id: builtin::rag/knowledge_search
    provider_id: rag
    provider_type: inline::rag

  # Memory query
  - tool_id: builtin::memory/query
    provider_id: memory
    provider_type: inline::memory
```

### Telemetry

```yaml
telemetry:
  - provider_id: meta-reference
    provider_type: inline::meta-reference
    config:
      service_name: myloware
      sinks:
        - console
        - otel_trace
        - otel_metric
      otel_exporter_otlp_endpoint: ${env.OTEL_EXPORTER_OTLP_ENDPOINT:-http://localhost:4318}
```

All agent operations are traced. Query traces by run_id:

```python
from observability.telemetry import query_run_traces

traces = query_run_traces(client, run_id="abc-123")
for trace in traces:
    print(f"Agent: {trace.attributes.get('agent_name')}")
    print(f"Duration: {trace.duration_ms}ms")
```

### Evaluation

```yaml
eval:
  - provider_id: meta-reference
    provider_type: inline::meta-reference

scoring:
  - provider_id: llm-as-judge
    provider_type: inline::llm-as-judge
    config:
      judge_model: meta-llama/Llama-3.2-3B-Instruct

datasetio:
  - provider_id: localfs
    provider_type: inline::localfs
    config:
      path: ./datasets
```

Run quality assessments:

```python
from observability.evaluation import run_evaluation

results = run_evaluation(
    client=client,
    dataset_id="ideator-eval",
    scoring_functions=["llm-as-judge::quality"],
)
```

## Agent Architecture

### Config-Driven Agents

Agents are defined in YAML files with inheritance:

```
data/
├── shared/
│   └── agents/
│       ├── ideator.yaml      # Base config
│       ├── producer.yaml
│       ├── editor.yaml
│       ├── publisher.yaml
│       └── supervisor.yaml
│
└── projects/
    └── aismr/
        └── agents/
            └── ideator.yaml  # Override for ASMR-specific instructions
```

The factory merges base + override:

```python
from agents.factory import create_agent

# Loads data/shared/agents/ideator.yaml
# Merges data/projects/aismr/agents/ideator.yaml
agent = create_agent(client, "aismr", "ideator")
```

### Agent YAML Structure

```yaml
role: ideator
description: Creative ideator for video production

model: meta-llama/Llama-3.2-3B-Instruct

instructions: |
  You are the Ideator for MyloWare video production.
  
  ## Role
  Generate creative, engaging video ideas...
  
  ## Tools
  - Use websearch for trending topics
  - Use knowledge_search for project context
  
  ## Output Format
  For each idea, provide:
  1. Title
  2. Hook
  3. Description

tools:
  - builtin::websearch
  - builtin::rag/knowledge_search

shields:
  input:
    - llama_guard
  output:
    - llama_guard
```

### Custom Tools

External API tools extend `MylowareBaseTool`:

```python
from tools.base import MylowareBaseTool

class KIEGenerationTool(MylowareBaseTool):
    def get_name(self) -> str:
        return "kie_generate"
    
    def get_description(self) -> str:
        return "Generate video clips using KIE.ai"
    
    def get_params_definition(self) -> dict:
        return {
            "prompts": ToolParamDefinition(
                param_type="list",
                description="Visual prompts for each clip",
                required=True,
            ),
        }
    
    async def run_impl(self, prompts: list, **kwargs) -> dict:
        # Call KIE API
        return {"job_ids": [...]}
```

## Running Llama Stack

### Local Development

```bash
# 1. Set environment variables
export TOGETHER_API_KEY=your-key

# 2. Start Llama Stack
llama stack run llama_stack/run.yaml

# 3. Verify
curl http://localhost:5001/health
```

### With Docker Compose

```yaml
# docker-compose.yml
services:
  llama-stack:
    image: llamastack/llama-stack:latest
    ports:
      - "5001:5001"
    volumes:
      - ./llama_stack/run.yaml:/app/run.yaml
    environment:
      - TOGETHER_API_KEY=${TOGETHER_API_KEY}
    command: ["llama", "stack", "run", "/app/run.yaml"]

  myloware:
    build: .
    ports:
      - "8000:8000"
    environment:
      - LLAMA_STACK_URL=http://llama-stack:5001
    depends_on:
      - llama-stack
```

## Troubleshooting

### "Model not found"

Ensure the model is registered in `run.yaml`:

```yaml
models:
  - model_id: meta-llama/Llama-3.2-3B-Instruct
    provider_id: together
    provider_model_id: meta-llama/Llama-3.2-3B-Instruct
```

### "Shield not found"

Ensure shields are configured:

```yaml
shields:
  - shield_id: llama_guard
    provider_id: llama-guard
```

### "Tool not available"

Ensure the tool is registered:

```yaml
tools:
  # Web search provided by Together distribution (builtin::websearch)
  # No configuration needed - uses Tavily
```

### Slow inference

Together AI is fastest for cloud inference. For local development, consider:
- Using smaller models (3B vs 8B)
- Caching frequent requests
- Using fake providers for testing

## Further Reading

- [Llama Stack Documentation](https://github.com/meta-llama/llama-stack)
- [Together AI Models](https://together.ai/models)
- [Llama Guard Paper](https://ai.meta.com/research/publications/llama-guard-llm-based-input-output-safeguard-for-human-ai-conversations/)

