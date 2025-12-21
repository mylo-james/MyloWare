# ADR-0002: Remotion for Video Rendering

**Status**: Accepted
**Date**: 2024-12-06

## Context

The Editor agent composes video clips into finished videos with:
- Text overlays and animations
- Transitions between clips
- Color grading and effects
- Precise timing control

The rendering engine is a core capability. Options: cloud API (Shotstack), self-hosted (Remotion), or raw FFmpeg.

## Decision

**Self-hosted Remotion** renders all videos. The Editor agent generates React/TSX code that Remotion compiles to MP4.

Why Remotion:

1. **AI-native** — LLMs excel at generating React code
2. **Programmatic** — Code defines video, no visual editor needed
3. **Self-hosted** — Zero per-render API costs
4. **Full control** — Any animation React can render

Architecture:
```
Editor Agent → TSX composition → remotion-service → MP4
```

The service runs in a Docker container alongside the main API.

**Timing contract**: Template-based compositions are authored at **30fps** with fixed frame counts.
The API enforces `fps=30` for templates to avoid timeline drift; custom compositions may use other fps values.

## Consequences

### Positive

- Zero render costs (vs. ~$0.05/video on Shotstack)
- LLMs generate React naturally
- Deterministic: same code = same video
- Local development without API keys

### Negative

- Must maintain Remotion service
- Self-hosted is slower than cloud GPU
- Requires headless Chrome
- More moving parts than API call

### Neutral

- Docker makes deployment manageable
- Can scale horizontally if needed
- RAG knowledge base helps with Remotion APIs

## Alternatives Rejected

| Option | Why Not |
|--------|---------|
| **Shotstack** | Per-render costs. JSON timeline less natural for LLMs. Vendor lock-in. |
| **FFmpeg direct** | Command-line not suited for complex compositions. No animations. |
| **MoviePy** | Python-based (slow). Limited animations. Memory intensive. |

## Implementation

```yaml
# docker-compose.yml
remotion-service:
  build: ./remotion-service
  ports:
    - "3001:3001"
```

See ADR-0007 for the Render Provider abstraction that enables cloud rendering when needed.

## References

- [Remotion Documentation](https://www.remotion.dev/docs)
- [Remotion Docker Guide](https://www.remotion.dev/docs/docker)
