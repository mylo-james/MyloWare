<p align="center">
  <img src="https://raw.githubusercontent.com/meta-llama/llama-stack/main/docs/resources/llama-stack-logo.png" width="200" alt="Llama Stack">
</p>

<h1 align="center">MyloWare</h1>

<p align="center">
  <strong>A production-grade multi-agent video production platform built entirely on Llama Stack</strong>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#llama-stack-integration">Llama Stack</a> •
  <a href="#development">Development</a> •
  <a href="#deployment">Deployment</a>
</p>

<p align="center">
  <a href="https://github.com/your-org/myloware/actions/workflows/ci.yml"><img src="https://github.com/your-org/myloware/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://codecov.io/gh/your-org/myloware"><img src="https://codecov.io/gh/your-org/myloware/branch/main/graph/badge.svg" alt="Coverage"></a>
  <img src="https://img.shields.io/badge/python-3.11+-blue.svg" alt="Python">
  <img src="https://img.shields.io/badge/llama--stack-0.3.4+-green.svg" alt="Llama Stack">
</p>

---

## What is MyloWare?

MyloWare demonstrates how to build a **production-ready, multi-agent application** using [Llama Stack](https://github.com/meta-llama/llama-stack) as the foundation. It's not a wrapper around LangChain or another framework—it's built from the ground up on Llama Stack's unified API.

**The workflow**: A user sends a message via Telegram → A supervisor agent classifies the request → Multiple specialized agents collaborate to produce a video → The video is published to TikTok.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           MyloWare Architecture                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│    Telegram ──▶ Supervisor ──▶ Ideator ──▶ Producer ──▶ Editor ──▶ Publisher │
│        │            │             │           │           │           │     │
│        │            │             │           │           │           │     │
│        ▼            ▼             ▼           ▼           ▼           ▼     │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                      Llama Stack Distribution                        │   │
│   │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │   │
│   │  │ Agents   │ │  Tools   │ │ Vector IO│ │  Safety  │ │Telemetry │  │   │
│   │  │   API    │ │   API    │ │   API    │ │   API    │ │   API    │  │   │
│   │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘  │   │
│   │                                                                     │   │
│   │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐               │   │
│   │  │  Memory  │ │  Eval    │ │ Datasetio│ │ Scoring  │               │   │
│   │  │   API    │ │   API    │ │   API    │ │   API    │               │   │
│   │  └──────────┘ └──────────┘ └──────────┘ └──────────┘               │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼                                        │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                         Together AI                                  │   │
│   │               (Llama 3.2 3B/8B + Llama Guard 3)                     │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Features

### 🦙 **100% Llama Stack Native**

No LangChain. No LangGraph. No abstractions on top of abstractions. MyloWare uses Llama Stack's APIs directly:

| Llama Stack API  | MyloWare Usage                              |
| ---------------- | ------------------------------------------- |
| **Agents API**   | Multi-agent orchestration with tool calling |
| **Tools API**    | Web Search (Tavily), RAG, Memory, Custom tools |
| **Vector I/O**   | Knowledge base for project context          |
| **Memory Banks** | User preference persistence                 |
| **Safety API**   | Llama Guard input/output shields            |
| **Telemetry**    | Full trace correlation across agents        |
| **Eval API**     | Quality assessment with LLM-as-judge        |
| **Datasetio**    | Dataset management for evaluations          |

### 🎭 **Multi-Agent Pipeline**

```yaml
# data/projects/aismr/workflow.yaml
steps:
  - agent: ideator # Generate video ideas using web research + knowledge
    hitl_gate: post_ideation
  - agent: producer # Create video clips with KIE.ai
  - agent: editor # Render final video with Remotion
  - agent: publisher # Publish to TikTok
    hitl_gate: pre_publish
```

### 🔧 **Config-Driven Agents**

Agent definitions live in YAML with inheritance:

```yaml
# data/shared/agents/ideator.yaml (base)
role: ideator
model: meta-llama/Llama-3.2-3B-Instruct
tools:
  - builtin::websearch
  - builtin::rag/knowledge_search
shields:
  input: [llama_guard]
  output: [llama_guard]

# data/projects/aismr/agents/ideator.yaml (override)
instructions: |
  You are a creative ideator for ASMR video production...
```

### 👤 **Human-in-the-Loop Gates**

Workflows pause at HITL gates for human approval:

```python
result = run_workflow(client, "Create a calming video about rain")
# → Status: AWAITING_IDEATION_APPROVAL

result = approve_gate(client, run_id, gate="ideation")
# → Continues to producer → editor → AWAITING_PUBLISH_APPROVAL
```

### 📊 **Full Observability**

Every agent turn is traced with Llama Stack Telemetry:

```python
from observability.telemetry import query_run_traces

traces = query_run_traces(client, run_id="abc-123")
# Returns all spans for this run across all agents
```

## Quick Start

### Prerequisites

- Python 3.11+
- [Together AI](https://together.ai) API key

### 1. Clone & Install

```bash
git clone https://github.com/your-org/myloware.git
cd myloware

python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your API keys:

```bash
# Required
TOGETHER_API_KEY=your-together-api-key
API_KEY=your-myloware-api-key

# External Services (for video production)
KIE_API_KEY=your-kie-api-key
UPLOAD_POST_API_KEY=your-upload-post-api-key
```

### 3. Start Llama Stack

```bash
# Start the Llama Stack distribution
llama stack run llama_stack/run.yaml
```

### 4. Run Tests

```bash
# Unit tests (all mocked, no API calls)
pytest tests/unit/ -v

# Integration tests (uses real Llama Stack)
pytest tests/integration/ -v -m integration
```

### 5. Start the API

```bash
# Start FastAPI server
uvicorn api.server:app --reload
```

### 6. Try It Out

```bash
# Check health
curl http://localhost:8000/health

# Start a workflow
curl -X POST http://localhost:8000/v1/runs/start \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"project": "test_video_gen", "brief": "Create a calming nature video"}'
```

## Llama Stack Integration

### Distribution Configuration

MyloWare's Llama Stack configuration lives in `llama_stack/run.yaml`:

```yaml
# Inference via Together AI
inference:
  - provider_id: together
    provider_type: remote::together
    config:
      api_key: ${env.TOGETHER_API_KEY}

# Models available
models:
  - model_id: meta-llama/Llama-3.2-3B-Instruct
    provider_id: together
  - model_id: meta-llama/Llama-Guard-3-8B
    provider_id: together

# Safety shields
shields:
  - shield_id: llama_guard
    provider_id: llama-guard

# Knowledge base
vector_dbs:
  - vector_db_id: myloware-knowledge
    provider_id: faiss

# User preferences
memory_banks:
  - memory_bank_id: user-preferences
    provider_id: faiss

# Tools
tools:
  # Web search provided by Together distribution (builtin::websearch)
  - tool_id: builtin::rag/knowledge_search
  - tool_id: builtin::memory/query

# Observability
telemetry:
  - provider_id: meta-reference
    config:
      service_name: myloware
      sinks: [console, otel_trace, otel_metric]
```

### Agent Creation

Agents are created using the factory with config inheritance:

```python
from agents.factory import create_agent

# Creates agent from:
# 1. data/shared/agents/ideator.yaml (base)
# 2. data/projects/aismr/agents/ideator.yaml (override)
agent = create_agent(
    client=client,
    project="aismr",
    role="ideator",
    vector_db_id="myloware-knowledge",
)

# Use the agent
session = agent.create_session("my-session")
response = agent.create_turn(
    session_id=session,
    messages=[{"role": "user", "content": "Generate ASMR video ideas"}],
)
```

### Tools

MyloWare uses both Llama Stack built-in tools and custom tools:

| Tool                            | Type     | Used By                      |
| ------------------------------- | -------- | ---------------------------- |
| `builtin::websearch`            | Built-in | Ideator (web research)       |
| `builtin::rag/knowledge_search` | Built-in | All agents (project context) |
| `builtin::memory/query`         | Built-in | Supervisor (user prefs)      |
| `kie_generate`                  | Custom   | Producer (video generation)  |
| `remotion_render`               | Custom   | Editor (video rendering)     |
| `upload_post`                   | Custom   | Publisher (TikTok posting)   |

## Project Structure

```
MyloWare/
├── src/
│   ├── agents/           # Agent factory and role-specific code
│   ├── api/              # FastAPI application
│   ├── cli/              # Command-line interface
│   ├── config/           # Settings, loaders, guardrails
│   ├── knowledge/        # Knowledge base loading
│   ├── memory/           # Memory bank operations
│   ├── observability/    # Telemetry, evaluation, datasets
│   ├── storage/          # Database models and repositories
│   ├── tools/            # Custom Llama Stack tools
│   └── workflows/        # Orchestrator and HITL gates
│
├── data/
│   ├── shared/
│   │   └── agents/       # Base agent YAML configs
│   ├── projects/
│   │   ├── aismr/        # ASMR video project
│   │   └── test_video_gen/  # Test project
│   └── knowledge/        # Knowledge base documents
│
├── llama_stack/
│   └── run.yaml          # Llama Stack distribution config
│
├── tests/
│   ├── unit/             # Unit tests (mocked)
│   └── integration/      # Integration tests (real APIs)
│
└── scripts/
    └── deploy/           # Fly.io deployment scripts
```

## Development

### Quick Commands

```bash
# Setup
make dev-install    # Install with dev dependencies + pre-commit hooks

# Quality checks
make lint           # Run ruff linter
make format         # Auto-format code
make type-check     # Run mypy
make test           # Run unit tests
make ci             # Run all checks (lint + mypy + test)

# Docker
make docker-up      # Start all services
make docker-down    # Stop services
make docker-logs    # Follow logs

# Database
make db-migrate     # Run migrations
```

### Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/ARCHITECTURE.md) | System design and component overview |
| [Runbook](docs/RUNBOOK.md) | Production operations guide |
| [ADRs](docs/decisions/) | Architecture Decision Records |
| [Contributing](CONTRIBUTING.md) | How to contribute |

### Pre-commit Hooks

This project uses pre-commit hooks for code quality:

```bash
pip install pre-commit
pre-commit install

# Run manually
pre-commit run --all-files
```

## Deployment

### Fly.io (Recommended)

```bash
# 1. Initial setup
./scripts/deploy/setup.sh

# 2. Configure secrets
./scripts/deploy/secrets.sh

# 3. Deploy
./scripts/deploy/deploy.sh

# 4. Register Telegram webhook
./scripts/deploy/telegram_webhook.sh
```

### Docker

```bash
# Build
docker build -t myloware .

# Run
docker run -p 8000:8000 --env-file .env myloware
```

## Testing Strategy

| Level           | Command                 | What It Tests                         |
| --------------- | ----------------------- | ------------------------------------- |
| **Unit**        | `pytest tests/unit/`    | All logic with mocked clients         |
| **Integration** | `pytest -m integration` | Real Llama Stack + fake external APIs |
| **E2E**         | Manual via Telegram     | Full flow including real video APIs   |

```bash
# Quick check (recommended before commits)
pytest tests/unit/ -v --tb=short

# Full test with coverage
pytest tests/unit/ -v --cov=src --cov-report=html
```

## API Reference

### Endpoints

| Method | Path                        | Description          |
| ------ | --------------------------- | -------------------- |
| `GET`  | `/health`                   | Health check         |
| `POST` | `/v1/runs/start`            | Start a workflow     |
| `GET`  | `/v1/runs/{run_id}`         | Get run status       |
| `POST` | `/v1/runs/{run_id}/approve` | Approve HITL gate    |
| `POST` | `/v1/chat/supervisor`       | Chat with supervisor |
| `POST` | `/v1/telegram/webhook`      | Telegram webhook     |
| `POST` | `/v1/webhooks/kieai`        | KIE.ai callback      |
| `POST` | `/v1/webhooks/remotion`     | Remotion callback    |

### Authentication

All endpoints (except webhooks) require an API key:

```bash
curl -H "X-API-Key: your-api-key" http://localhost:8000/v1/runs
```

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Run tests: `pytest tests/unit/`
4. Run linting: `ruff check src/`
5. Commit: `git commit -m 'Add amazing feature'`
6. Push: `git push origin feature/amazing-feature`
7. Open a Pull Request

## License

MIT License - see [LICENSE](LICENSE) for details.

---

<p align="center">
  Built with 🦙 <a href="https://github.com/meta-llama/llama-stack">Llama Stack</a>
</p>
