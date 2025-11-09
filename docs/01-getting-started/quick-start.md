# Quick Start

**Audience:** Developers new to MyloWare  
**Time:** 5 minutes  
**Outcome:** Running MCP server with health check passing

---

## Prerequisites

- Docker and Docker Compose installed
- Node.js 20+ installed
- Git installed

---

## Steps

### 1. Clone and Install

```bash
git clone https://github.com/yourusername/MyloWare
cd MyloWare
npm install
```

### 2. Set Up Environment

```bash
cp .env.example .env
```

Edit `.env` and add your OpenAI API key:

```bash
OPENAI_API_KEY=sk-your-key-here
```

### 3. Start Services

```bash
npm run dev:docker
```

This starts:
- PostgreSQL with pgvector
- MCP server
- n8n workflow engine

### 4. Verify Health

```bash
curl http://localhost:3456/health
```

Expected response:

```json
{
  "status": "healthy",
  "checks": {
    "database": "ok",
    "openai": "ok"
  }
}
```

---

## Validation

✅ Health endpoint returns `"status": "healthy"`  
✅ Database check is `"ok"`  
✅ OpenAI check is `"ok"`

---

## Next Steps

- [Complete Local Setup](local-setup.md) - Full development environment
- [First End-to-End Run](first-run-e2e.md) - Test the full pipeline
- [System Overview](../02-architecture/system-overview.md) - Understand the architecture

---

## Troubleshooting

**Database won't start?**
```bash
docker compose down -v
npm run dev:docker
```

**OpenAI check failing?**
- Verify your API key is valid
- Check you have credits available

**Port conflicts?**
- MCP server uses 3456
- n8n uses 5678
- PostgreSQL uses 5432

See [Troubleshooting Guide](../05-operations/troubleshooting.md) for more help.

