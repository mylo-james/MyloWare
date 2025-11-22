# MyloWare - Multi-Agent AI Video Production Platform

<p align="center">
  <strong>Production-grade orchestration platform coordinating specialized AI agents for automated video content creation</strong>
</p>

<p align="center">
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-features">Features</a> •
  <a href="#%EF%B8%8F-architecture">Architecture</a> •
  <a href="docs/">Documentation</a> •
  <a href="ROADMAP.md">Roadmap</a> •
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/python-3.11-blue" alt="Python 3.11"/>
  <img src="https://img.shields.io/badge/coverage-%E2%89%A582%25-brightgreen" alt="Coverage ≥82%"/>
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License"/>
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen" alt="PRs Welcome"/>
</p>

---

## 🎬 What is MyloWare?

MyloWare is a **production-ready AI orchestration platform** that coordinates multiple specialized AI agents to automate complex video production workflows - from ideation through generation, editing, and publishing.

**Think of it as a conductor for AI agents:** One agent brainstorms creative concepts (Iggy), another generates video clips (Riley), a third assembles and edits them (Alex), and a fourth publishes to social platforms (Quinn) - all coordinated through a robust LangGraph state machine with human oversight gates.

### Perfect For

- 🎥 **Content Creators** - Automate video production at scale
- 🏢 **Engineering Teams** - Learn production-grade multi-agent patterns
- 📊 **AI Researchers** - Explore multi-agent coordination strategies
- 🚀 **Startups** - Build AI-powered media pipelines quickly

### Key Highlights

- **🤖 Multi-Agent Coordination** - Specialized AI personas (Supervisor, Ideator, Producer, Editor, Publisher) collaborate via LangGraph state machines
- **🔒 Production-Grade** - HITL gates, audit logging, webhook reliability (DLQ + idempotency), circuit breakers, 82% test coverage
- **🎨 Complete Video Pipeline** - End-to-end: ideation → generation (kie.ai) → editing (Shotstack) → publishing (TikTok via upload-post)
- **📊 Full Observability** - LangSmith tracing, Prometheus metrics, Grafana dashboards, Sentry error tracking
- **🚀 Cloud-Ready** - Deployed on Fly.io with PostgreSQL+pgvector, Redis, Docker
- **✅ Well-Tested** - 82% code coverage enforced via CI, comprehensive unit & integration tests

---

## 📽️ Quick Demo

```bash
# Start a production AISMR workflow via the Brendan supervisor
curl -X POST http://localhost:8080/v1/chat/brendan \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "demo",
    "message": "Create an AISMR video about ocean waves and rain"
  }'

# What happens:
# 1. Brendan (supervisor) analyzes the request → proposes workflow
# 2. Iggy (ideator) generates 12 creative modifiers → HITL approval gate
# 3. Riley (producer) generates video clips via kie.ai → waits for webhooks
# 4. Alex (editor) assembles timeline and renders via Shotstack
# 5. Quinn (publisher) posts to TikTok with metadata → returns URL

# Or use the CLI:
mw-py demo aismr
```

---

## 🏗️ Architecture

```
┌─────────────────┐
│  Entry Points   │
│  - Telegram     │──────┐
│  - HTTP API     │      │
│  - MCP Client   │      │
└─────────────────┘      │
                         ▼
                  ┌──────────────┐         ┌──────────────────┐
                  │   FastAPI    │────────▶│   PostgreSQL     │
                  │   Gateway    │         │   + pgvector     │
                  │   :8080      │         │   (knowledge)    │
                  └──────────────┘         └──────────────────┘
                         │
                         ▼
                  ┌──────────────┐         ┌──────────────────┐
                  │  LangGraph   │────────▶│   LangSmith      │
                  │ Orchestrator │         │    (tracing)     │
                  │   :8090      │         └──────────────────┘
                  └──────────────┘
                         │
            ┌────────────┼────────────┬────────────┐
            ▼            ▼            ▼            ▼
       ┌────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐
       │Brendan │  │  Iggy   │  │  Riley  │  │  Alex   │  ...
       │(Super) │  │(Ideate) │  │(Produce)│  │ (Edit)  │
       └────────┘  └─────────┘  └─────────┘  └─────────┘
```

**Tech Stack:**
- **Backend:** Python 3.11, FastAPI, LangChain, LangGraph
- **Database:** PostgreSQL 15 + pgvector (for knowledge retrieval)
- **Caching:** Redis
- **AI:** OpenAI GPT-4, embedding models
- **Video:** kie.ai (generation), Shotstack (editing), FFmpeg (normalization)
- **Observability:** LangSmith, Prometheus, Grafana, Sentry
- **Deployment:** Docker, Fly.io

---

## 🚀 Quick Start

### Prerequisites
- Python 3.11+
- Docker & Docker Compose
- OpenAI API key (for LLM functionality)

### 1. Clone and Setup

```bash
git clone https://github.com/mylo-james/myloware.git
cd myloware

# Create virtual environment
python3.11 -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -e '.[dev]'
```

### 2. Configure Environment

```bash
# Copy example env file
cp .env.example .env

# Edit .env with your API keys (minimum required):
# - API_KEY (for auth)
# - OPENAI_API_KEY (for LLM)
# - DB_URL will use local Postgres via Docker
```

### 3. Start Services

```bash
# Start Postgres, Redis, API, Orchestrator, Prometheus, Grafana
make up

# Run database migrations
make migrate

# Verify services are healthy
curl http://localhost:8080/health
curl http://localhost:8090/health
```

### 4. Run a Workflow

```bash
# Start a test workflow via CLI
mw-py demo aismr

# Or via direct API call
curl -X POST http://localhost:8080/v1/chat/brendan \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"user_id":"demo","message":"Create an AISMR video about candles"}'

# For production workflows, enable LangChain personas:
export ENABLE_LANGCHAIN_PERSONAS=true
make restart
```

### 5. Run Tests

```bash
make test              # Unit tests (mock mode by default)
make test-coverage     # Full suite with coverage check (≥82%)
make smoke             # Quick smoke test
```

**Next Steps:** See [Documentation](docs/README.md) for detailed guides.

---

## 📚 Documentation

- **[Getting Started](docs/01-getting-started/)** - Installation, setup, first run
- **[Architecture](docs/02-architecture/)** - System design, patterns, decisions
- **[How-To Guides](docs/03-how-to/)** - Common tasks and workflows
- **[Operations](docs/05-operations/)** - Deployment, monitoring, troubleshooting
- **[API Reference](docs/06-reference/)** - Endpoints, CLI, configuration
- **[Contributing](docs/07-contributing/)** - Development guide, coding standards

---

## 🗺️ Roadmap

See [ROADMAP.md](ROADMAP.md) for planned features and release timeline.

**Current Release:** v1.0 - Production baseline with complete multi-agent orchestration (Nov 2025)

**Next:** v1.1.0 - Publishing expansion (YouTube, Instagram Reels)

---

## 🧪 Testing

```bash
make test                  # Run unit tests
make test-coverage         # Run with coverage report (≥82% enforced)
make lint                  # Run linters (ruff + custom rules)
```

**Current Coverage:** 82% (target: ≥80%)

**Test Organization:**
- `tests/unit/` - Fast, isolated unit tests
- `tests/integration/` - Cross-component integration tests
- `tests/integration/live/` - Optional live provider tests (gated behind `@pytest.mark.live_smoke`)

---

## 🛠️ Development

### Local Development Loop

```bash
make up                    # Start all services
make down                  # Stop all services
make logs                  # Tail API + orchestrator logs
make lint                  # Run linters
mw-py validate env         # Check environment setup
mw-py runs watch <run_id>  # Watch a run in real-time
```

### Project Structure

```
myloware/
├── apps/               # Application services
│   ├── api/           # FastAPI gateway (Brendan front door)
│   ├── orchestrator/  # LangGraph workflow execution
│   └── mcp_adapter/   # Optional MCP integration
├── adapters/          # External service integrations
│   ├── ai_providers/  # kie.ai, Shotstack
│   ├── social/        # upload-post (TikTok)
│   └── persistence/   # Database, cache, vector store
├── core/              # Business logic
├── content/           # Video editing, persona guidance
├── cli/               # Unified command-line interface (mw-py)
├── tests/             # Comprehensive test suite
├── docs/              # Documentation
└── infra/             # Docker Compose, configs
```

---

## 🚢 Deployment

### Fly.io (Production)

```bash
# Deploy API
flyctl deploy -c fly.api.toml --strategy immediate

# Deploy Orchestrator
flyctl deploy -c fly.orchestrator.toml --strategy immediate

# Set secrets
flyctl secrets set API_KEY=xxx OPENAI_API_KEY=xxx DB_URL=xxx LANGSMITH_API_KEY=xxx
```

### Docker (Any Platform)

```bash
# Build images
docker compose -f infra/docker-compose.yml build

# Run in production mode
docker compose -f infra/docker-compose.yml up -d
```

See [Deployment Guide](docs/03-how-to/release-cut-and-rollback.md) for details.

---

## 📊 Observability

- **LangSmith:** Every AI interaction is traced with run context
- **Prometheus + Grafana:** Metrics dashboards at `:9090` and `:3000`
- **Sentry:** Error tracking and alerting with release tagging
- **Structured Logging:** JSON logs with request IDs for distributed tracing

---

## 🔐 Security

- ✅ API key authentication on all endpoints
- ✅ HMAC webhook signature verification (SHA-256)
- ✅ Host allowlists for SSRF protection
- ✅ Secrets management via environment variables
- ✅ Idempotency keys for webhook replay protection
- ✅ Automated security scanning in CI (pip-audit)

See [Security Guide](docs/05-operations/security-hardening.md).

---

## 🤝 Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Quick Links
- [Development Setup](docs/01-getting-started/new-developer-onboarding.md)
- [Testing Guide](docs/07-contributing/testing.md)
- [Adding a Persona](docs/03-how-to/add-a-persona.md)
- [Adding a Project](docs/03-how-to/add-a-project.md)

---

## 📝 License

MIT License - see [LICENSE](LICENSE) for details.

---

## 🙏 Acknowledgments

Built with:
- [LangChain](https://langchain.com/) & [LangGraph](https://langchain-ai.github.io/langgraph/) - AI orchestration
- [FastAPI](https://fastapi.tiangolo.com/) - Modern Python web framework
- [PostgreSQL](https://postgresql.org/) + [pgvector](https://github.com/pgvector/pgvector) - Vector database
- [Fly.io](https://fly.io/) - Cloud deployment platform

---

## 📧 Contact

- **GitHub:** [@mylo-james](https://github.com/mylo-james)
- **LinkedIn:** [Mylo James](https://www.linkedin.com/in/myloj/)
- **Email:** mylo.james114@gmail.com

---

<p align="center">
  <sub>Built to demonstrate production-grade AI orchestration patterns</sub>
</p>
