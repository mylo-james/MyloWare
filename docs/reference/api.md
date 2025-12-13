# API Reference

> **Reference**: Technical specification of REST API endpoints. For a tutorial on using the API, see [Quickstart](../tutorials/quickstart.md).

REST API endpoints.

---

## Authentication

All endpoints (except `/health` and webhooks) require an API key:

```
X-API-Key: your-api-key
```

---

## Endpoints

### Health

```
GET /health
```

Returns service status. No authentication required.

**Response**:
```json
{
  "status": "healthy",
  "version": "0.1.0"
}
```

---

### Start Workflow

```
POST /v1/runs/start
```

Start a new video production workflow.

**Request**:
```json
{
  "project": "aismr",
  "brief": "Create a relaxing rain video"
}
```

**Response**:
```json
{
  "run_id": "uuid",
  "status": "pending"
}
```

---

### Get Run Status

```
GET /v1/runs/{run_id}
```

**Response**:
```json
{
  "run_id": "uuid",
  "status": "awaiting_ideation_approval",
  "current_step": "ideator",
  "artifacts": {}
}
```

**Status values**:
- `pending`
- `running`
- `awaiting_ideation_approval`
- `awaiting_video_generation`
- `awaiting_render`
- `awaiting_publish_approval`
- `completed`
- `failed`

---

### Approve Gate

```
POST /v1/runs/{run_id}/approve
```

Approve a human-in-the-loop gate.

**Request**:
```json
{
  "gate": "ideation",
  "approved": true,
  "comment": "Looks good"
}
```

---

### Chat with Supervisor

```
POST /v1/chat/supervisor
```

Interactive chat with the supervisor agent.

**Request**:
```json
{
  "message": "What videos should I make today?",
  "session_id": "optional-session-id"
}
```

---

## Webhooks

### Sora Callback

```
POST /v1/webhooks/sora?run_id={run_id}
```

Called by OpenAI Sora when video generation completes.

### Remotion Callback

```
POST /v1/webhooks/remotion?run_id={run_id}
```

Called by Remotion service when render completes.

---

## Rate Limits

- 60 requests/minute per API key
- 429 response includes `retry_after_seconds`

---

## OpenAPI Spec

Full specification available at `/openapi.json` or in `openapi.json` in the repository.
