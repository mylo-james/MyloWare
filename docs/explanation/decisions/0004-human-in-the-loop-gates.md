# ADR-0004: Human-in-the-Loop Gates

**Status**: Accepted
**Date**: 2024-12-06

## Context

AI workflows produce unexpected results. For video production:
- **Ideation**: AI may generate off-brand ideas
- **Publishing**: Content needs approval before posting publicly

Fully automated publishing to social media is risky. Human oversight is essential.

## Decision

**HITL Gates** pause workflows until a human approves.

Gates:
| Gate | Status | When |
|------|--------|------|
| `post_ideation` | `AWAITING_IDEATION_APPROVAL` | After ideas generated |
| `pre_publish` | `AWAITING_PUBLISH_APPROVAL` | Before social posting |

Flow:
```
[Ideator] → HITL Gate → [Producer] → [Editor] → HITL Gate → [Publisher]
              ↓                                      ↓
        Human approves                         Human approves
```

Approval via API or **Telegram inline buttons**:
```
🎬 Ideas ready for review:
1. "Calming puppies in a meadow..."

[✅ Approve] [❌ Reject] [✏️ Edit]
```

## Consequences

### Positive

- Quality control before costly operations
- Brand safety before public posting
- Feedback for future improvement
- Async-friendly (review when available)

### Negative

- Human review adds delay (minutes to hours)
- Need notification system
- State management across approvals

### Neutral

- Telegram works well for mobile approval
- API enables other approval systems

## Alternatives Rejected

| Option | Why Not |
|--------|---------|
| **No gates** | Risk of publishing inappropriate content. |
| **Synchronous** | Poor UX. Can't scale. Mobile users blocked. |
| **Email approval** | Higher friction. Slower response. |

## Implementation

```python
# Workflow pauses at gate
result = run_workflow(client, brief="puppies")
# result.status = "awaiting_ideation_approval"

# Human approves
approve_gate(client, run_id, gate="ideation", approved=True)
# Workflow continues
```

## References

- [Human-in-the-Loop ML](https://en.wikipedia.org/wiki/Human-in-the-loop)
