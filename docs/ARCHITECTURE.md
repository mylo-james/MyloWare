# MyloWare Architecture

## Overview

MyloWare is a **Llama Stack-native** multi-agent video production platform. It demonstrates how to build production-grade AI applications using Llama Stack's unified API without additional AI frameworks.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              MyloWare System                                    │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌─────────────┐     ┌─────────────────────────────────────────────────────┐   │
│  │  Telegram   │────▶│                  FastAPI Server                      │   │
│  │   Bot       │     │  ┌───────────┐  ┌───────────┐  ┌───────────┐        │   │
│  └─────────────┘     │  │  /chat    │  │  /runs    │  │ /webhooks │        │   │
│                      │  │ supervisor│  │  CRUD     │  │ KIE/Shot  │        │   │
│                      │  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘        │   │
│                      └────────┼──────────────┼──────────────┼──────────────┘   │
│                               │              │              │                   │
│                               ▼              ▼              ▼                   │
│  ┌────────────────────────────────────────────────────────────────────────┐    │
│  │                      Workflow Orchestrator                              │    │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ │    │
│  │  │ Ideator  │─▶│ Producer │─▶│  Editor  │─▶│Publisher │  │Supervisor│ │    │
│  │  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘ │    │
│  │       │             │             │             │             │       │    │
│  │       ▼             ▼             ▼             ▼             ▼       │    │
│  │  [websearch] [kie_gen]   [remotion]    [upload_post]  [memory]      │    │
│  │  [rag]          [rag]       [rag]         [rag]          [rag]       │    │
│  └────────────────────────────────────────────────────────────────────────┘    │
│                               │                                                 │
│                               ▼                                                 │
│  ┌────────────────────────────────────────────────────────────────────────┐    │
│  │                    Llama Stack Distribution                             │    │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ │    │
│  │  │  Agents  │  │  Tools   │  │ Vector IO│  │  Memory  │  │  Safety  │ │    │
│  │  │   API    │  │   API    │  │   API    │  │   API    │  │   API    │ │    │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘ │    │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐                             │    │
│  │  │Telemetry │  │   Eval   │  │ Datasetio│                             │    │
│  │  │   API    │  │   API    │  │   API    │                             │    │
│  │  └──────────┘  └──────────┘  └──────────┘                             │    │
│  └────────────────────────────────────────────────────────────────────────┘    │
│                               │                                                 │
│                               ▼                                                 │
│  ┌────────────────────────────────────────────────────────────────────────┐    │
│  │                     Together AI (Inference)                             │    │
│  │          Llama 3.2 3B/8B Instruct  •  Llama Guard 3 8B                 │    │
│  └────────────────────────────────────────────────────────────────────────┘    │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘

External Services:
┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│   KIE.ai     │  │  Remotion    │  │  Upload-Post │  │   Tavily     │
│ (video gen)  │  │  (render)    │  │  (publish)   │  │  (research)  │
└──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘
```

## Core Components

### 1. Agent System

Agents are created dynamically from YAML configuration files with inheritance:

```
data/
├── shared/agents/          # Base configurations
│   ├── ideator.yaml        # Default ideator settings
│   ├── producer.yaml
│   ├── editor.yaml
│   ├── publisher.yaml
│   └── supervisor.yaml
│
└── projects/
    └── aismr/
        └── agents/
            └── ideator.yaml  # ASMR-specific overrides
```

**Agent Creation Flow:**

```python
from agents.factory import create_agent

# 1. Load base config from data/shared/agents/ideator.yaml
# 2. Load override from data/projects/aismr/agents/ideator.yaml
# 3. Deep merge configs
# 4. Create Llama Stack Agent with merged settings

agent = create_agent(client, "aismr", "ideator", vector_db_id="kb")
```

### 2. Workflow Orchestrator

The orchestrator manages multi-agent pipelines with HITL gates:

```
run_workflow()
    │
    ├─▶ Create Run (RUNNING)
    │
    ├─▶ Execute Ideator
    │       └─▶ Generate ideas using websearch + rag
    │
    ├─▶ Store Artifacts
    │
    └─▶ Pause at HITL Gate (AWAITING_IDEATION_APPROVAL)
            │
            ▼
continue_after_ideation()
    │
    ├─▶ Execute Producer
    │       └─▶ Generate clips using kie_generate + rag
    │
    ├─▶ Execute Editor
    │       └─▶ Render video using remotion_render + rag
    │
    └─▶ Pause at HITL Gate (AWAITING_PUBLISH_APPROVAL)
            │
            ▼
continue_after_publish_approval()
    │
    ├─▶ Execute Publisher
    │       └─▶ Publish to TikTok using upload_post
    │
    └─▶ Complete Run (COMPLETED)
```

### 3. Config-Driven Architecture

All agent behavior is defined in configuration:

```yaml
# data/shared/agents/ideator.yaml
role: ideator
model: meta-llama/Llama-3.2-3B-Instruct

instructions: |
  You are the Ideator for video production.
  Use websearch for trending topics.
  Use knowledge_search for project context.

tools:
  - builtin::websearch
  - builtin::rag/knowledge_search

shields:
  input: [llama_guard]
  output: [llama_guard]
```

```yaml
# data/projects/aismr/workflow.yaml
steps:
  - agent: ideator
    hitl_gate: post_ideation
  - agent: producer
  - agent: editor
  - agent: publisher
    hitl_gate: pre_publish
```

### 4. Tool System

MyloWare uses both Llama Stack built-in tools and custom tools:

| Tool | Type | Location | Used By |
|------|------|----------|---------|
| `builtin::websearch` | Built-in | Llama Stack (Tavily) | Ideator |
| `builtin::rag/knowledge_search` | Built-in | Llama Stack | All |
| `builtin::memory/query` | Built-in | Llama Stack | Supervisor |
| `kie_generate` | Custom | `src/tools/kie.py` | Producer |
| `remotion_render` | Custom | `src/tools/remotion.py` | Editor |
| `upload_post` | Custom | `src/tools/publish.py` | Publisher |

Custom tools extend `MylowareBaseTool`:

```python
class KIEGenerationTool(MylowareBaseTool):
    def get_name(self) -> str:
        return "kie_generate"
    
    async def run_impl(self, prompts: list) -> dict:
        # Call KIE API
        return {"job_ids": [...]}
```

### 5. Data Flow

```
                    Input
                      │
                      ▼
┌─────────────────────────────────────────────┐
│               Llama Guard                    │
│           (Input Safety Shield)              │
└─────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────┐
│                  Agent                       │
│  ┌─────────────────────────────────────┐    │
│  │           Instructions               │    │
│  │   (from YAML config + override)     │    │
│  └─────────────────────────────────────┘    │
│                    │                        │
│                    ▼                        │
│  ┌─────────────────────────────────────┐    │
│  │          Tool Execution              │    │
│  │  • websearch (web research)         │    │
│  │  • rag/knowledge_search (context)   │    │
│  │  • custom tools (external APIs)     │    │
│  └─────────────────────────────────────┘    │
│                    │                        │
│                    ▼                        │
│  ┌─────────────────────────────────────┐    │
│  │          LLM Inference               │    │
│  │     (Together AI / Llama 3.2)       │    │
│  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────┐
│               Llama Guard                    │
│           (Output Safety Shield)             │
└─────────────────────────────────────────────┘
                      │
                      ▼
                   Output
```

## Database Schema

```sql
-- Workflow runs
CREATE TABLE runs (
    id UUID PRIMARY KEY,
    workflow_name VARCHAR(100),
    input TEXT,
    status VARCHAR(50),
    current_step VARCHAR(100),
    artifacts JSONB,
    error TEXT,
    user_id VARCHAR(255),
    telegram_chat_id VARCHAR(100),
    llama_stack_trace_id VARCHAR(255),
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Artifacts produced by agents
CREATE TABLE artifacts (
    id UUID PRIMARY KEY,
    run_id UUID REFERENCES runs(id),
    persona VARCHAR(100),
    artifact_type VARCHAR(50),
    content TEXT,
    metadata JSONB,
    trace_id VARCHAR(255),
    created_at TIMESTAMP
);
```

## Deployment Architecture

### Fly.io Production

```
┌──────────────────────────────────────────────────────────────────┐
│                         Fly.io                                    │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─────────────────┐      ┌─────────────────┐                    │
│  │   MyloWare API  │◀────▶│   Fly Postgres  │                    │
│  │   (FastAPI)     │      │   (PostgreSQL)  │                    │
│  └────────┬────────┘      └─────────────────┘                    │
│           │                                                       │
│           │ LLAMA_STACK_URL                                       │
│           ▼                                                       │
│  ┌─────────────────┐                                             │
│  │  Llama Stack    │                                             │
│  │  Distribution   │                                             │
│  └────────┬────────┘                                             │
│           │                                                       │
│           │ TOGETHER_API_KEY                                      │
│           ▼                                                       │
└───────────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────┐
│   Together AI   │
│   (Inference)   │
└─────────────────┘
```

### Local Development

```yaml
# docker-compose.yml
services:
  llama-stack:
    image: llamastack/llama-stack:latest
    ports: ["5001:5001"]
    
  postgres:
    image: postgres:15
    ports: ["5432:5432"]
    
  myloware:
    build: .
    ports: ["8000:8000"]
    depends_on: [llama-stack, postgres]
```

## Security Model

### Authentication

- **API Key**: Required header `X-API-Key` for all endpoints
- **Telegram**: Webhook signature verification
- **External Webhooks**: IP allowlisting + signature verification

### Safety

- **Input Shields**: Llama Guard filters harmful user inputs
- **Output Shields**: Llama Guard filters harmful model outputs
- **Guardrails**: Project-specific content rules in `data/projects/*/guardrails/`

## Observability

### Telemetry

All operations are traced via Llama Stack Telemetry:

```python
# Query traces for a run
from observability.telemetry import query_run_traces

traces = query_run_traces(client, run_id="abc-123")
for trace in traces:
    print(f"{trace.operation}: {trace.duration_ms}ms")
```

### Logging

Structured logging with correlation IDs:

```python
logger.info(
    "Agent turn completed",
    extra={
        "run_id": str(run_id),
        "agent": "ideator",
        "duration_ms": 1234,
    }
)
```

## Extension Points

### Adding a New Agent Role

1. Create base config: `data/shared/agents/new_role.yaml`
2. Add to workflows: `data/projects/*/workflow.yaml`
3. Register in orchestrator if needed

### Adding a New Project

1. Create project config: `data/projects/myproject/config.yaml`
2. Create workflow: `data/projects/myproject/workflow.yaml`
3. Add agent overrides: `data/projects/myproject/agents/*.yaml`
4. Add guardrails: `data/projects/myproject/guardrails/*.json`

### Adding a New Custom Tool

1. Create tool class in `src/tools/`
2. Extend `MylowareBaseTool`
3. Register in agent YAML configs
4. Add fake provider for testing

## Design Principles

1. **Llama Stack Native**: Use Llama Stack APIs directly, no additional frameworks
2. **Config-Driven**: Agent behavior defined in YAML, not hardcoded
3. **Fail-Fast**: No silent failures, crash loudly with useful errors
4. **Observable**: Everything traced and loggable
5. **Testable**: Fake providers for all external services

