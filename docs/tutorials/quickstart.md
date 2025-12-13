# Quickstart

> **Tutorial**: This guide walks you through getting MyloWare running locally. By the end, you'll have created your first video workflow.

Get MyloWare running locally in 5 minutes.

---

## Prerequisites

- Python 3.11+
- Docker
- API key from [Together AI](https://together.ai)

---

## 1. Clone and Install

```bash
git clone https://github.com/mylo-james/myloware.git
cd myloware

python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

---

## 2. Configure

```bash
cp .env.example .env
```

Edit `.env`:

```bash
API_KEY=your-secret-key
LLAMA_STACK_URL=http://localhost:5001
TOGETHER_API_KEY=your-together-key
```

---

## 3. Start Services

```bash
docker compose up -d
```

This starts:
- **Llama Stack** (port 5001) — AI inference
- **PostgreSQL** (port 5432) — Database
- **Jaeger** (port 16686) — Tracing UI

---

## 4. Run the API

```bash
uvicorn api.server:app --reload
```

---

## 5. Verify

```bash
# Health check
curl http://localhost:8000/health

# Start a workflow
curl -X POST http://localhost:8000/v1/runs/start \
  -H "X-API-Key: your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{"project": "test_video_gen", "brief": "Create a calming nature video"}'
```

---

## Next Steps

- [Add an Agent](../how-to/add-agent.md) — Customize agent behavior
- [Architecture](../explanation/architecture.md) — Understand the system

