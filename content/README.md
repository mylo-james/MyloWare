# Content Pipelines

`content/` contains pure-first logic for ideation, scripting, generation, editing, and publishing.
The current `api/services/test_video_gen.py` and helpers in `libs/` will be decomposed into the
following packages:

- `ideation/` — topic generation + validation.
- `scripting/` — script generation, timing, guardrails.
- `generation/` — provider-agnostic video/image generation blueprints.
- `editing/` — timeline assembly, transitions, normalization (FFmpeg).
- `publishing/` — caption/call-to-action builders and platform-specific formatting.

Each module should depend only on `core/` and adapter interfaces, never on FastAPI/LangGraph.

