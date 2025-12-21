# Local Postgres + Milvus Setup

Use this to run LangGraph (Postgres checkpoints/DLQ) while keeping Milvus for retrieval.

## Quick start (Docker)
```bash
# Postgres
docker run --name myloware-pg -e POSTGRES_PASSWORD=myloware -e POSTGRES_USER=myloware \
  -e POSTGRES_DB=myloware -p 5432:5432 -d postgres:16

# Milvus standalone (Light)
docker run --name milvus -p 19530:19530 -p 9091:9091 -d milvusdb/milvus:v2.4.3-standalone
```

## Compose snippet
```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: myloware
      POSTGRES_PASSWORD: myloware
      POSTGRES_DB: myloware
    ports: ["5432:5432"]

  milvus:
    image: milvusdb/milvus:v2.4.3-standalone
    ports:
      - "19530:19530"
      - "9091:9091"
```

## Environment
```
DATABASE_URL=postgresql+psycopg2://myloware:myloware@localhost:5432/myloware
USE_LANGGRAPH_ENGINE=true
MILVUS_URI=localhost:19530
```

## Migrations
Run after Postgres is up (order matters: checkpoint/DLQ tables needed for LangGraph):
```bash
alembic upgrade head
```

## Notes
- LangGraph checkpoints and DLQ use Postgres only.
- Milvus holds vectors/hybrid retrieval; artifacts/runs stay in Postgres.
- Tests can still use SQLite overrides (`sqlite+aiosqlite://…`) for fake-provider paths; LangGraph checkpoints require Postgres in real runs.
