# ADR-0005: Webhook Callback Pattern

**Status**: Accepted  
**Date**: 2024-12-06

## Context

Video generation (OpenAI Sora) and rendering (Remotion) are long-running operations (1-5 minutes). The workflow needs to:
1. Submit jobs to external services
2. Continue when jobs complete
3. Handle failures gracefully

Options: polling, webhooks, or WebSockets.

## Decision

**Webhook callbacks.** External services POST to our API when jobs complete.

Flow:
```
[MyloWare] → POST job to Sora (includes callback_url)
                    ↓
[Sora] processes video (1-3 min)
                    ↓
[Sora] → POST to callback_url with results
                    ↓
[MyloWare] → Updates run, continues workflow
```

Callback URL format:
```
{WEBHOOK_BASE_URL}/v1/webhooks/{service}?run_id={run_id}
```

Tools include `run_id` at creation, baked into the callback URL.

## Consequences

### Positive

- No polling (resource efficient)
- Immediate continuation when job completes
- Standard pattern (Stripe, GitHub use webhooks)
- Simple HTTP POST, easy to debug

### Negative

- Endpoints must be publicly accessible
- Need to validate webhook authenticity
- Handle duplicates and out-of-order delivery
- Local dev requires tunneling (ngrok)

### Neutral

- Well-understood by developers

## Security

1. **Run ID validation** — Verify run exists and is in expected state
2. **HMAC signatures** — Validate webhook authenticity (planned)
3. **Rate limiting** — Prevent webhook flooding
4. **Idempotency** — Handle duplicate calls gracefully

## Alternatives Rejected

| Option | Why Not |
|--------|---------|
| **Polling** | Wasteful. Slower (polling interval). Complex error handling. |
| **WebSockets** | Overkill for infrequent updates. External services don't support it. |
| **Message queue** | Additional infrastructure. External services don't publish to queues. |

## Implementation

```python
@router.post("/webhooks/sora")
async def sora_callback(run_id: str = Query(...)):
    run = run_repo.get(UUID(run_id))
    if run.status != RunStatus.AWAITING_VIDEO_GENERATION:
        raise HTTPException(400, "Invalid state")
    
    payload = await request.json()
    artifact_repo.create(run_id=run.id, content=payload["video_url"])
    await continue_workflow(run_id)
```

## References

- [Webhook Best Practices](https://webhooks.fyi/)
