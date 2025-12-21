# ADR-0007: Render Provider Abstraction

**Status**: Accepted
**Date**: 2024-12-06

## Context

ADR-0002 established self-hosted Remotion as the rendering engine. This works well for development and moderate load, but has limitations:

1. **No burst capacity** — Local service has fixed concurrency
2. **No preview renders** — Same pipeline for preview and final
3. **Fly.io constraints** — Limited CPU for rendering

Eventually, we may want cloud rendering (Remotion Lambda) for:
- Burst capacity without provisioning
- Faster renders with more resources
- Preview renders at lower quality/cost

But we don't need it now. The abstraction should exist so we can add it later without rewiring workflows.

## Decision

**Introduce a `RenderProvider` interface** that abstracts local vs. cloud rendering. Implement only the local provider now.

```python
class RenderProvider(Protocol):
    async def render(
        self,
        composition: str,
        props: dict,
        webhook_url: str | None = None
    ) -> RenderJob:
        """Submit a render job."""
        ...

    async def get_status(self, job_id: str) -> RenderJob:
        """Check job status."""
        ...
```

Implementations:
- **`LocalRemotionProvider`** — Calls `remotion-service` (built now)
- **`LambdaRemotionProvider`** — Calls Remotion Lambda API (built when needed)

Factory selects provider:
```python
def get_render_provider() -> RenderProvider:
    if settings.render_provider == "lambda":
        return LambdaRemotionProvider(...)
    return LocalRemotionProvider(settings.remotion_service_url)
```

### What We're Building Now

1. `RenderProvider` protocol definition
2. `LocalRemotionProvider` wrapping existing service
3. Factory function with `RENDER_PROVIDER=local` default

### What We're NOT Building Now

- `LambdaRemotionProvider` — Build when Fly.io costs exceed benefit
- S3 artifact storage — Lambda provider will need this
- Preview vs. final quality modes — Add with Lambda provider

## Consequences

### Positive

- Workflows use interface, not implementation
- Can add Lambda provider without workflow changes
- Testing simplified (mock provider)
- Clear extension point documented

### Negative

- Slight abstraction overhead (one more layer)
- Interface may need adjustment when we add Lambda
- Risk of premature abstraction (mitigated: interface is minimal)

### Neutral

- Existing Remotion service unchanged
- Webhook pattern still works (all providers support callbacks)

## Alternatives Considered

| Option | Why Not |
|--------|---------|
| **Build Lambda provider now** | YAGNI. Adds cost and complexity we don't need yet. |
| **No abstraction** | Would require workflow changes when adding cloud. |
| **Queue-based system** | Additional infrastructure. Providers handle their own queuing. |

## Implementation

```python
# src/myloware/services/render_provider.py
from typing import Any, Protocol

class RenderProvider(Protocol):
    async def render(
        self,
        composition: str,
        props: dict[str, Any],
        webhook_url: str | None = None,
    ) -> RenderJob: ...
    async def get_status(self, job_id: str) -> RenderJob: ...

# src/myloware/services/render_local.py
class LocalRemotionProvider:
    def __init__(self, service_url: str):
        self.service_url = service_url

    async def render(
        self,
        composition: str,
        props: dict[str, Any],
        webhook_url: str | None = None,
    ) -> RenderJob:
        async with httpx.AsyncClient() as client:
            resp = await client.post(f"{self.service_url}/render", json={...})
            return RenderJob(job_id=resp.json()["job_id"], status=RenderStatus.PENDING)
```

## When to Build Lambda Provider

Trigger conditions (any one):
- Fly.io render costs > $50/month
- Render queue depth > 5 regularly
- Need preview renders at different quality

See ADR-0008 for overall scope philosophy.

## References

- [Remotion Lambda](https://www.remotion.dev/docs/lambda)
- [Strategy Pattern](https://refactoring.guru/design-patterns/strategy)
- [ADR-0002: Remotion Video Rendering](./0002-remotion-video-rendering.md)
