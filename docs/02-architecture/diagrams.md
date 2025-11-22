# Architecture Diagrams

Visual reference for how MyloWare's services, personas, and reliability controls fit together.

## System Overview

```mermaid
graph LR
  subgraph Entry[Entry Points]
    TGM[Telegram]
    HTTP[HTTP API]
    MCP[MCP Client]
  end

  subgraph Gateway[FastAPI Gateway]
    BR[Brendan Chat /v1/chat/brendan]
    HITL[HITL Approvals /v1/hitl]
    WH[Webhook Receivers]
  end

  subgraph Orchestrator[LangGraph Orchestrator]
    SUP[Supervisor Node]
    IGG[Iggy (Ideate)]
    RIL[Riley (Produce)]
    ALX[Alex (Edit)]
    QNN[Quinn (Publish)]
  end

  subgraph Data[Data Stores]
    PG[(Postgres + pgvector)]
    REDIS[(Redis)]
    S3[(Artifact Storage)]
  end

  Entry --> BR
  Entry --> HITL
  Entry --> WH
  BR --> Orchestrator
  HITL --> Orchestrator
  Orchestrator --> PG
  Orchestrator --> REDIS
  Orchestrator --> S3
  WH --> Orchestrator
  Orchestrator -->|Traces| LS[LangSmith]
```

## Persona Pipeline (AISMR)

```mermaid
graph TD
  A[Brendan: classify + plan] --> B[Iggy: ideate prompts]
  B -->|HITL ideate| C[Riley: generate clips (kie.ai)]
  C --> D[Alex: assemble + render (Shotstack + FFmpeg)]
  D -->|HITL prepublish| E[Quinn: publish (upload-post/TikTok)]
  E --> F[Artifacts saved + canonical URL]
```

## Webhook Reliability Path

```mermaid
stateDiagram-v2
  [*] --> Waiting
  Waiting --> Received : Signature valid & allowlist
  Waiting --> Rejected : Signature invalid OR disallowed host
  Received --> Persisted : Store raw payload + headers
  Persisted --> Deduped : Check idempotency key
  Deduped --> Enqueued : Push to orchestrator queue
  Enqueued --> Processed : Persona resumes
  Enqueued --> DLQ : Max retries exceeded
  DLQ --> [*]
```

## Data Flow per Run

```mermaid
graph LR
  subgraph Run
    RS[Run State]
    CKPT[Checkpoint]
    ART[Artifacts]
  end
  subgraph Storage
    DB[(Postgres)]
    VEC[(pgvector)]
    CACHE[(Redis)]
  end
  RS -->|persist| DB
  CKPT -->|persist| DB
  ART -->|metadata| DB
  ART -->|blobs| S3[(Object Storage)]
  RS -->|embeddings| VEC
  RS -->|hot state| CACHE
```

## Observability Signals

```mermaid
graph LR
  API[FastAPI Gateway] --> MET[Prometheus]
  ORC[Orchestrator] --> MET
  API --> TR[LangSmith / OTel]
  ORC --> TR
  TR --> Sentry[Sentry]
  MET --> Graf[Grafana Dashboards]
```

## Extension Points

```mermaid
graph TD
  subgraph Registries
    PR[Provider Registry]
    PE[Persona Registry]
    PJ[Project Registry]
  end
  NewProvider[Add provider folder] --> PR
  NewPersona[Add persona folder] --> PE
  NewProject[Add project folder] --> PJ
  PR --> Orchestrator
  PE --> Orchestrator
  PJ --> Orchestrator
```
