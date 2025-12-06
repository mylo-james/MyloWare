# Developer Quickstart

Get MyloWare running locally in 5 minutes.

## Prerequisites

- **Python 3.11+**
- **Docker** (recommended) or manual setup
- API keys for:
  - [Together AI](https://together.ai) (required for inference)

## Option A: Docker Compose (Recommended)

The easiest way to run MyloWare with all dependencies.

### Step 1: Configure Environment

```bash
# Copy the example environment file
cp .env.example .env
```

Edit `.env` with your API keys:

```bash
TOGETHER_API_KEY=your-together-api-key
API_KEY=any-string-for-local-testing  # Or generate a secure key
```

### Step 2: Start Everything

```bash
docker compose up -d
```

This starts:
- **Llama Stack** (port 5001) - AI inference with Together AI
- **PostgreSQL** (port 5432) - Database for runs/artifacts
- **Jaeger** (port 16686) - Tracing UI for observability
- **MyloWare API** (port 8000) - The main application

On startup, MyloWare automatically:
- Runs database migrations
- Registers the vector database for RAG
- Ingests knowledge documents from `data/knowledge/`

### Step 3: Verify

```bash
# Check all services are healthy
docker compose ps

# Check MyloWare health
curl http://localhost:8000/health
# {"status":"healthy","version":"0.1.0"}

# Check knowledge base was set up (in logs)
docker compose logs myloware | grep -E "(Vector|Ingested)"
# Vector database registered: project_kb_myloware
# Ingested 8 knowledge documents
```

### Step 4: Run a Test Workflow

```bash
curl -X POST http://localhost:8000/v1/runs/start \
  -H "X-API-Key: $(grep API_KEY .env | cut -d'=' -f2)" \
  -H "Content-Type: application/json" \
  -d '{"project": "test_video_gen", "brief": "Create a relaxing ocean waves video"}'
```

### Step 5: Watch the Traces

Open http://localhost:16686 (Jaeger) to see:
- Agent execution traces
- Tool calls (websearch, knowledge_search)
- Timing for each step

---

## Option B: Manual Setup

For development without Docker.

### Step 1: Clone & Install

```bash
git clone https://github.com/your-org/myloware.git
cd myloware

python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate

pip install -e ".[dev]"
```

### Step 2: Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:
```bash
TOGETHER_API_KEY=your-together-api-key
API_KEY=dev-api-key
DATABASE_URL=sqlite:///./myloware.db  # Or PostgreSQL
```

### Step 3: Start Llama Stack

```bash
docker run -p 5001:5001 \
  -e TOGETHER_API_KEY=$TOGETHER_API_KEY \
  llamastack/distribution-together:latest \
  --port 5001
```

### Step 4: Run Migrations

```bash
PYTHONPATH=src alembic upgrade head
```

### Step 5: Start MyloWare API

```bash
PYTHONPATH=src uvicorn api.server:app --reload
```

The API will automatically:
- Register the vector database
- Ingest knowledge documents from `data/knowledge/`

---

## Project Structure

```
myloware/
├── src/
│   ├── agents/       # Agent factory and definitions
│   ├── api/          # FastAPI application
│   ├── config/       # Settings and config loaders
│   ├── knowledge/    # RAG setup and ingestion
│   ├── tools/        # Custom Llama Stack tools
│   └── workflows/    # Orchestrator and HITL
│
├── data/
│   ├── knowledge/       # Documents for RAG (auto-ingested on startup)
│   ├── shared/agents/   # Base agent YAML configs
│   └── projects/        # Project-specific configs
│
└── tests/
    ├── unit/            # Unit tests (mocked, no API calls)
    └── integration/     # Integration tests (real Llama Stack)
```

---

## Common Tasks

### Run Tests

```bash
# Unit tests (fast, no API calls)
PYTHONPATH=src pytest tests/unit/ -v --tb=short

# Integration tests (requires running Llama Stack)
PYTHONPATH=src pytest tests/integration/ -v --tb=short
```

### Run Linting

```bash
ruff check src/ tests/
black --check src/ tests/
```

### View Logs

```bash
# All services
docker compose logs -f

# Just MyloWare
docker compose logs -f myloware
```

### Rebuild After Code Changes

```bash
docker compose build myloware
docker compose up -d myloware
```

### Add Knowledge Documents

1. Add `.md` files to `data/knowledge/`
2. Restart the API: `docker compose restart myloware`
3. Documents are automatically ingested on startup

---

## Troubleshooting

### "Vector_db not served by provider"

The vector database wasn't registered. Check startup logs:
```bash
docker compose logs myloware | grep -E "(Vector|Failed)"
```

If it failed, restart: `docker compose restart myloware`

### "Connection refused" to Llama Stack

```bash
# Check if Llama Stack is running
curl http://localhost:5001/v1/models

# Check container health
docker compose ps
```

### Database Migration Errors

```bash
# Re-run migrations
docker compose exec myloware alembic upgrade head
```

### Knowledge Not Found in RAG

Verify documents were ingested:
```bash
docker compose logs myloware | grep "Ingested"
```

Check the vector database exists:
```bash
curl http://localhost:5001/v1/vector-dbs | python3 -m json.tool
```

---

## Next Steps

1. **Read the docs**: [LLAMA_STACK.md](LLAMA_STACK.md) for Llama Stack details
2. **Explore agents**: `data/shared/agents/*.yaml`
3. **Watch traces**: http://localhost:16686 (Jaeger)
4. **Run tests**: `PYTHONPATH=src pytest tests/unit/ -v`
