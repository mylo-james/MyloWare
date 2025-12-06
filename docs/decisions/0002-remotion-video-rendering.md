# ADR-0002: Remotion for Video Rendering

**Status**: Accepted
**Date**: 2025-12-06
**Authors**: MyloWare Team

## Context

The Editor agent needs to compose video clips into final rendered videos with:
- Text overlays and animations
- Transitions between clips
- Color grading and effects
- Precise timing control

Options evaluated:
1. **Shotstack** - Cloud API for video rendering
2. **Remotion** - React-based programmatic video (self-hosted)
3. **FFmpeg** - Direct command-line video processing
4. **MoviePy** - Python video editing library

## Decision

We chose **Remotion** as a self-hosted rendering service because:

1. **AI-Native**: LLMs can generate React/TSX code directly
2. **Programmatic**: No visual editor needed - code defines the video
3. **Self-Hosted**: No per-render API costs
4. **Flexible**: Full control over animations, effects, timing

Architecture:
```
Editor Agent → generates TSX code → RemotionRenderTool → remotion-service → MP4
```

The Editor agent writes React composition code, which is submitted to our self-hosted Remotion service for rendering.

## Consequences

### Positive

- **Zero Render Costs**: No per-video API fees (Shotstack charges ~$0.05/video)
- **AI Code Generation**: LLMs excel at generating React code
- **Full Control**: Any animation or effect possible in React
- **Deterministic**: Same code = same video output
- **Local Development**: Render videos without API calls

### Negative

- **Infrastructure**: Must run and maintain Remotion service
- **Render Time**: Self-hosted may be slower than cloud (no GPU by default)
- **Chrome Dependency**: Requires headless Chrome for rendering
- **Complexity**: More moving parts than a simple API call

### Neutral

- Docker containerization makes deployment manageable
- Can scale horizontally if needed
- Learning curve for Remotion APIs (mitigated by RAG knowledge base)

## Alternatives Considered

### Alternative 1: Shotstack

**Rejected because**:
- Per-render costs add up at scale (~$0.05/video)
- Timeline JSON format less natural for LLM generation
- Vendor lock-in for a core capability
- Limited customization of effects

### Alternative 2: FFmpeg Direct

**Rejected because**:
- Command-line interface not suitable for complex compositions
- Text overlay positioning is complex
- No animation capabilities
- Would need significant wrapper code

### Alternative 3: MoviePy

**Rejected because**:
- Python-based (slower than native)
- Limited animation capabilities
- Text rendering quality issues
- Memory intensive for longer videos

## Implementation Details

```yaml
# docker-compose.yml
remotion-service:
  build: ./remotion-service
  ports:
    - "3001:3001"
  environment:
    - CONCURRENCY=2
```

```python
# RemotionRenderTool submits composition code
result = client.tools.remotion_render(
    composition_code=tsx_code,
    clips=clip_urls,
    duration_seconds=30,
)
```

## References

- [Remotion Documentation](https://www.remotion.dev/docs)
- [Shotstack Pricing](https://shotstack.io/pricing/)
- [Remotion Docker Guide](https://www.remotion.dev/docs/docker)

