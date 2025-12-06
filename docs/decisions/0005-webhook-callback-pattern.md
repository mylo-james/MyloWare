# ADR-0005: Webhook Callback Pattern

**Status**: Accepted
**Date**: 2025-12-06
**Authors**: MyloWare Team

## Context

Video generation (KIE.ai) and rendering (Remotion) are long-running operations (1-5 minutes). We need a pattern to:

1. Submit jobs to external services
2. Continue workflow when jobs complete
3. Handle failures gracefully

Options:
1. **Polling**: Periodically check job status
2. **Webhooks**: External service calls us when done
3. **WebSockets**: Real-time bidirectional connection

## Decision

We use **Webhook Callbacks** where external services POST to our API when jobs complete.

### Architecture

```
[MyloWare] → POST job to KIE.ai (includes callback_url)
    ↓
[KIE.ai] processes video (1-3 min)
    ↓
[KIE.ai] → POST to callback_url with results
    ↓
[MyloWare Webhook Handler] → Updates run, continues workflow
```

### Callback URL Format

```
{WEBHOOK_BASE_URL}/v1/webhooks/{service}?run_id={run_id}

Examples:
- https://myloware.fly.dev/v1/webhooks/kieai?run_id=abc-123
- https://myloware.fly.dev/v1/webhooks/remotion?run_id=xyz-789
```

### Webhook Payload Handling

```python
# KIE.ai callback
@router.post("/webhooks/kieai")
async def kie_callback(
    request: Request,
    run_id: str = Query(...),
):
    payload = await request.json()
    # payload contains: task_id, status, video_url, etc.
    
    # Update run with video URLs
    # Continue workflow to next step
```

### Tool Design

Tools include `run_id` at creation time, which is baked into the callback URL:

```python
# Factory creates tool with run context
tool = KIEGenerationTool(run_id=run_id)
# Tool builds callback_url internally:
# f"{WEBHOOK_BASE_URL}/v1/webhooks/kieai?run_id={run_id}"
```

## Consequences

### Positive

- **No Polling**: No need to repeatedly check status
- **Immediate**: Workflow continues as soon as job completes
- **Scalable**: External service handles retry logic
- **Simple**: Standard HTTP POST, easy to debug

### Negative

- **Public Endpoint**: Webhook endpoints must be publicly accessible
- **Security**: Need to validate webhook authenticity
- **Reliability**: Must handle duplicate deliveries, out-of-order calls
- **Local Dev**: Requires tunneling (ngrok) for local testing

### Neutral

- Standard pattern used by Stripe, GitHub, etc.
- Well-understood by developers

## Security Measures

1. **Run ID Validation**: Verify run_id exists and is in expected state
2. **Signature Verification**: (Future) Validate webhook signatures
3. **Rate Limiting**: Prevent webhook flooding
4. **Idempotency**: Handle duplicate webhook calls gracefully

## Alternatives Considered

### Alternative 1: Polling

**Rejected because**:
- Wasteful of resources (constant API calls)
- Slower response (polling interval delay)
- More complex error handling

### Alternative 2: WebSockets

**Rejected because**:
- Overkill for infrequent updates
- More complex connection management
- External services don't support WebSocket callbacks

### Alternative 3: Message Queue (SQS, RabbitMQ)

**Rejected because**:
- Additional infrastructure to manage
- External services don't publish to queues
- Overkill for current scale

## Implementation Details

```python
# src/api/routes/webhooks.py
@router.post("/kieai")
async def kie_callback(
    request: Request,
    run_id: str = Query(...),
    db: Session = Depends(get_db),
):
    """Handle KIE.ai video generation callback."""
    run_repo = RunRepository(db)
    artifact_repo = ArtifactRepository(db)
    
    run = run_repo.get(UUID(run_id))
    if not run or run.status != RunStatus.PRODUCING:
        raise HTTPException(400, "Invalid run state")
    
    payload = await request.json()
    video_url = payload.get("video_url")
    
    # Store artifact
    artifact_repo.create(
        run_id=run.id,
        artifact_type=ArtifactType.VIDEO_CLIP,
        content=video_url,
    )
    
    # Continue workflow
    await continue_after_producer(run_id)
```

## References

- [Webhook Best Practices](https://webhooks.fyi/)
- [Stripe Webhooks](https://stripe.com/docs/webhooks)

