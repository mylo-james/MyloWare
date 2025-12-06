# ADR-0004: Human-in-the-Loop Gates

**Status**: Accepted
**Date**: 2025-12-06
**Authors**: MyloWare Team

## Context

Automated AI workflows can produce unexpected or inappropriate content. For video production:

1. **Ideation**: AI may generate off-brand or inappropriate ideas
2. **Production**: Generated video clips may need review
3. **Publishing**: Final content requires approval before public posting

Human oversight is essential for quality control and brand safety.

## Decision

We implement **HITL Gates** as workflow pause points where human approval is required before proceeding.

### Gate Types

| Gate | Status | Triggers When |
|------|--------|---------------|
| `post_ideation` | `AWAITING_IDEATION_APPROVAL` | After ideator generates ideas |
| `pre_publish` | `AWAITING_PUBLISH_APPROVAL` | Before publishing to social media |

### Gate Flow

```
[Ideator] → [HITL Gate: post_ideation] → [Producer] → [Editor] → [HITL Gate: pre_publish] → [Publisher]
                    ↓                                                        ↓
              Human approves/rejects                                   Human approves/rejects
```

### API Design

```python
# Workflow pauses at gate
result = run_workflow(client, brief="puppies")
# result.status = "awaiting_ideation_approval"

# Human reviews via API or Telegram
approve_gate(client, run_id, gate="ideation", approved=True)
# Workflow continues

# Or reject with feedback
approve_gate(client, run_id, gate="ideation", approved=False, feedback="Too generic")
# Workflow status = "rejected"
```

### Telegram Integration

Gates can be approved via inline buttons in Telegram:

```
🎬 New video ideas ready for review:
1. "Calming puppies playing in meadow..."

[✅ Approve] [❌ Reject] [✏️ Edit]
```

## Consequences

### Positive

- **Quality Control**: Humans verify AI output before costly operations
- **Brand Safety**: Content reviewed before public posting
- **Feedback Loop**: Rejections can include feedback for future improvement
- **Async Friendly**: Workflows persist state, humans review when available

### Negative

- **Latency**: Human review adds delay (minutes to hours)
- **Complexity**: Need notification system, approval UI
- **State Management**: Must persist workflow state across approvals

### Neutral

- Telegram provides good mobile approval experience
- API enables integration with other approval systems

## Alternatives Considered

### Alternative 1: No HITL Gates

**Rejected because**:
- Risk of publishing inappropriate content
- No quality control on AI output
- Unacceptable for brand accounts

### Alternative 2: Synchronous Gates (Blocking API)

**Rejected because**:
- Poor UX for long-running workflows
- Can't scale to multiple concurrent reviews
- Mobile users can't approve easily

### Alternative 3: Approval via Email

**Rejected because**:
- Higher friction than Telegram buttons
- Slower response times
- More complex to implement

## Implementation Details

```python
# src/workflows/hitl.py
def approve_gate(
    client: LlamaStackClient,
    run_id: UUID,
    gate: str,
    run_repo: RunRepository,
    **kwargs,
) -> WorkflowResult:
    """Approve a HITL gate and continue workflow."""
    run = run_repo.get(run_id)
    
    if gate == "ideation":
        return continue_after_ideation(client, run_id, ...)
    elif gate == "publish":
        return continue_after_publish_approval(client, run_id, ...)
```

## References

- [Human-in-the-Loop Machine Learning](https://en.wikipedia.org/wiki/Human-in-the-loop)
- [Content Moderation Best Practices](https://www.perspectiveapi.com/)

