# ADR-0008: Personal Scale Philosophy

**Status**: Accepted  
**Date**: 2024-12-06

## Context

MyloWare is a personal project built by a senior engineer. There's inherent tension between:

1. **Portfolio value** — Demonstrating architectural thinking, enterprise patterns
2. **Practical value** — Building what's actually useful
3. **Cost constraints** — Running on a budget

It's tempting to build OAuth2, Kubernetes, Prometheus dashboards, and multi-region AWS deployments. These are valuable skills to demonstrate. But for a single-user project, they're expensive distractions.

## Decision

**Personal scale, enterprise discipline.**

This means:
- **Document** like you have a team (ADRs, clear architecture)
- **Build** like you're the only one paying the bills (Fly.io, minimal infrastructure)
- **Scale** when metrics demand it, not when ego wants it

### Current Architecture (Fly.io)

| Component | Implementation | Monthly Cost |
|-----------|----------------|--------------|
| API | Fly.io Machine (shared-cpu-1x) | ~$5-10 |
| Database | Fly Postgres (single instance) | ~$0-7 |
| Remotion | Fly.io Machine | ~$5-10 |
| Auth | Single API key | $0 |
| Observability | Langfuse (free tier) + JSON logs | $0 |
| **Total** | | **~$10-27/mo** |

### Scale-Up Triggers (Document Now, Build Later)

| Capability | Trigger | What to Build |
|------------|---------|---------------|
| **Async DB** | DB ops are >30% of request latency (measured) | asyncpg migration |
| **Multi-user auth** | Adding second user | OAuth2/JWT |
| **Cloud rendering** | Render queue > 5 or costs > $50/mo | Lambda provider |
| **AWS migration** | Fly.io costs > $100/mo or need Lambda | Terraform + ECS |
| **Prometheus** | Langfuse insufficient for debugging | /metrics endpoint |

### What This ADR Prevents

❌ Building OAuth2 "because we might have users someday"  
❌ Writing Terraform for AWS "to show we know how"  
❌ Adding Prometheus "because enterprise apps have it"  
❌ Async DB migration "because async is better"  

### What This ADR Enables

✅ Documenting how OAuth2 would work (in this ADR)  
✅ Writing about AWS architecture (documented when needed)  
✅ Clean abstractions that make scaling easier (RenderProvider)  
✅ Measuring before optimizing  

## Consequences

### Positive

- Lower monthly costs (~$20 vs ~$150)
- Less maintenance burden
- Faster iteration (fewer moving parts)
- Clear decision framework for future features

### Negative

- Some optimizations deferred
- Less impressive demo infrastructure
- May need to retrofit patterns later

### Neutral

- ADRs document the "scale-up path" for learning value
- Architecture is cloud-ready even if not cloud-deployed

## The Scale-Up Path (Documented, Not Built)

When triggers are met, here's what we'd build:

### Multi-User (OAuth2/JWT)
```python
# JWT with scopes
claims = {"sub": "user-123", "scopes": ["read", "write"]}
# Backward-compatible: API key still works, logs deprecation
```

### AWS Infrastructure
```
infrastructure/terraform/
├── modules/vpc/        # 2 AZs, public/private subnets
├── modules/ecs/        # Fargate cluster
├── modules/rds/        # Aurora Serverless v2
└── modules/lambda/     # Remotion Lambda
```

### Prometheus Metrics
```python
REQUEST_LATENCY = Histogram("myloware_request_latency_seconds", ...)

@router.get("/metrics")
async def metrics():
    return Response(content=generate_latest())
```

These are documented for portfolio value and future reference. They are not built until triggers are met.

## The Mantra

> Build for one user.  
> Document for a team.  
> Scale when the numbers say so.

## References

- [YAGNI](https://martinfowler.com/bliki/Yagni.html)
- [Fly.io Pricing](https://fly.io/docs/about/pricing/)
- [Premature Optimization](https://wiki.c2.com/?PrematureOptimization)

