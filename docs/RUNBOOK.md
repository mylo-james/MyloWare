# MyloWare Production Runbook

Operational guide for running MyloWare in production.

---

## Quick Reference

| Service | Port | Health Check |
|---------|------|--------------|
| MyloWare API | 8000 | `GET /health` |
| Llama Stack | 5001 | `GET /v1/models` |
| PostgreSQL | 5432 | `pg_isready` |
| Remotion Service | 3001 | `GET /health` |

---

## Starting Services

### Local Development

```bash
# Start all services
make docker-up

# Run API in development mode
make serve

# Check status
docker compose ps
```

### Production (Fly.io)

```bash
# Deploy latest
flyctl deploy --app myloware-api

# Check status
flyctl status --app myloware-api

# View logs
flyctl logs --app myloware-api
```

---

## Health Checks

### API Health

```bash
curl http://localhost:8000/health
# Expected: {"status": "healthy", "version": "0.1.0"}
```

### Llama Stack Connection

```bash
curl http://localhost:5001/v1/models
# Expected: {"data": [{"id": "meta-llama/Llama-3.2-3B-Instruct", ...}]}
```

### Database Connection

```bash
# Check from API
curl http://localhost:8000/health | jq .database
# Expected: "connected"

# Direct check
pg_isready -h localhost -p 5432 -U myloware
```

---

## Common Operations

### Running a Workflow

```bash
# Via CLI
myloware workflow start aismr "Create an ASMR video about puppies"

# Via API
curl -X POST http://localhost:8000/runs \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"project": "aismr", "brief": "puppies"}'
```

### Checking Run Status

```bash
# Via CLI
myloware runs list
myloware runs watch <run_id>

# Via API
curl http://localhost:8000/runs/<run_id> \
  -H "Authorization: Bearer $API_KEY"
```

### Approving HITL Gate

```bash
# Via API
curl -X POST http://localhost:8000/runs/<run_id>/approve \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"gate": "post_ideation", "approved": true}'
```

---

## Database Operations

### Run Migrations

```bash
make db-migrate
# Or directly:
PYTHONPATH=src alembic upgrade head
```

### Check Migration Status

```bash
PYTHONPATH=src alembic current
PYTHONPATH=src alembic history
```

### Create New Migration

```bash
PYTHONPATH=src alembic revision -m "description_of_change"
```

### Reset Database (CAUTION)

```bash
# Drops all data!
make db-reset
```

---

## Troubleshooting

### API Not Starting

1. Check environment variables:
   ```bash
   env | grep -E "(DATABASE_URL|LLAMA_STACK|API_KEY)"
   ```

2. Check database connection:
   ```bash
   psql $DATABASE_URL -c "SELECT 1"
   ```

3. Check Llama Stack:
   ```bash
   curl $LLAMA_STACK_URL/v1/models
   ```

### Workflow Stuck

1. Check run status:
   ```bash
   curl http://localhost:8000/runs/<run_id> | jq .status
   ```

2. Common statuses:
   - `awaiting_ideation_approval`: Need HITL approval
   - `failed`: Check `error_message` field
   - `producing`: Waiting for KIE.ai webhook

3. Check logs:
   ```bash
   docker compose logs -f myloware-api | grep <run_id>
   ```

### Webhook Not Received

1. Verify webhook URL is configured in external service
2. Check webhook endpoint is accessible:
   ```bash
   curl -X POST http://localhost:8000/webhooks/kie \
     -H "Content-Type: application/json" \
     -d '{"test": true}'
   ```

3. Check for firewall/proxy issues

### KIE.ai Job Stuck

1. Check KIE.ai dashboard for job status
2. Verify `KIE_API_KEY` is set
3. Test API connection:
   ```bash
   curl -X GET "https://api.kie.ai/v1/jobs" \
     -H "Authorization: Bearer $KIE_API_KEY"
   ```

### Remotion Render Failing

1. Check Remotion service logs:
   ```bash
   docker compose logs remotion-service
   ```

2. Test render endpoint:
   ```bash
   curl http://localhost:3001/health
   ```

3. Common issues:
   - Chrome not installed in container
   - Out of disk space for renders
   - Invalid composition code

---

## Monitoring

### Langfuse Dashboard

Access at: https://langfuse.com (requires configured `LANGFUSE_*` env vars)

View:
- Agent traces
- Tool execution times
- Error rates

### Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f myloware-api

# Filter by level
docker compose logs -f myloware-api | grep -E "(ERROR|WARNING)"
```

### Metrics (if configured)

```bash
# Prometheus metrics endpoint (if enabled)
curl http://localhost:8000/metrics
```

---

## Scaling

### Horizontal Scaling (Fly.io)

```bash
# Scale to N instances
flyctl scale count 3 --app myloware-api

# Check current scale
flyctl scale show --app myloware-api
```

### Remotion Concurrency

Set in `docker-compose.yml`:
```yaml
remotion-service:
  environment:
    - CONCURRENCY=4  # Parallel render jobs
```

---

## Backup & Recovery

### Database Backup

```bash
# Create backup
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d).sql

# Restore backup
psql $DATABASE_URL < backup_20250101.sql
```

### Vector Store Backup

Vector stores are managed by Llama Stack. Backup the underlying storage:
- For Faiss: Backup index files
- For Chroma: Backup Chroma persist directory

---

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `LLAMA_STACK_URL` | Yes | Llama Stack server URL |
| `LLAMA_STACK_MODEL` | No | Default model (default: Llama-3.2-3B-Instruct) |
| `API_KEY` | Yes | API authentication key |
| `KIE_API_KEY` | No | KIE.ai API key (required for video generation) |
| `REMOTION_URL` | No | Remotion service URL (default: http://localhost:3001) |
| `TELEGRAM_BOT_TOKEN` | No | Telegram notifications bot token |
| `LANGFUSE_PUBLIC_KEY` | No | Langfuse observability public key |
| `LANGFUSE_SECRET_KEY` | No | Langfuse observability secret key |
| `USE_FAKE_PROVIDERS` | No | Use fake providers for testing (default: false) |

---

## Emergency Procedures

### Stop All Processing

```bash
# Stop API (prevents new runs)
flyctl scale count 0 --app myloware-api
# Or locally:
docker compose stop myloware-api
```

### Cancel Running Jobs

```bash
# Mark runs as cancelled
psql $DATABASE_URL -c "UPDATE runs SET status='cancelled' WHERE status IN ('producing', 'editing')"
```

### Rollback Deployment

```bash
# Fly.io
flyctl releases --app myloware-api
flyctl deploy --image <previous-image> --app myloware-api
```

---

## Contact

For escalation:
- Check GitHub Issues for known issues
- Review recent commits for related changes

