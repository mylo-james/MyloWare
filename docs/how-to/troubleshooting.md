# Troubleshooting

Common issues and fixes.

---

## Safety Shield Errors

**Symptom**: 400 response with `shield_error`

**Cause**: Llama Stack safety service is down or unreachable.

**Fix**:
1. Check Llama Stack is running: `curl http://localhost:5001/health`
2. Restart the distribution: `docker compose restart llama-stack`
3. Verify shield is registered in startup logs

**Note**: Safety is fail-closed by design. There is no bypass.

---

## Rate Limit Hit

**Symptom**: 429 response with `error=rate_limited`

**Cause**: Too many requests from same API key or IP.

**Fix**:
1. Honor `retry_after_seconds` in response
2. Use different API keys for different clients
3. Check for runaway retry loops in your code

---

## Knowledge Base Not Found

**Symptom**: RAG queries return empty or health shows `knowledge_base_healthy=false`

**Cause**: Vector database not initialized.

**Fix**:
1. Restart the API (ingestion runs on startup)
2. Check logs for "Ingested X documents"
3. Verify documents exist in `data/knowledge/`

---

## Render Rejected

**Symptom**: Remotion returns 400 for `composition_code`

**Cause**: Sandbox mode blocks dynamic code by default.

**Fix**:
- Use template mode (default, safe)
- Or enable sandbox: `REMOTION_SANDBOX_ENABLED=true` + `REMOTION_ALLOW_COMPOSITION_CODE=true`

**Warning**: Only enable composition code in isolated environments.

---

## Template Render Rejected (fps)

**Symptom**: Remotion returns 400 or tool raises `fps=30` error.

**Cause**: Templates are authored at 30fps with fixed frame counts.

**Fix**:
- Use `fps=30` for template renders, or
- Switch to `composition_code` for custom fps timelines.

---

## Database Connection Failed

**Symptom**: `sqlalchemy.exc.OperationalError`

**Fix**:
1. Check PostgreSQL is running: `docker compose ps`
2. Verify `DATABASE_URL` in `.env`
3. Run migrations: `alembic upgrade head`

---

## Llama Stack Timeout

**Symptom**: Requests hang or timeout after 30s

**Cause**: Model inference is slow or Together AI is overloaded.

**Fix**:
1. Use smaller model (3B vs 8B)
2. Check Together AI status page
3. For offline testing, set `LLAMA_STACK_PROVIDER=fake` (or `USE_FAKE_PROVIDERS=true`)
