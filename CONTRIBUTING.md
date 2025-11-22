# Contributing to MyloWare

Thanks for helping improve MyloWare! This guide covers how to set up your environment, make changes safely, and submit high-quality pull requests.

## Getting Started

1. Clone and create a virtualenv (Python 3.11):
   ```bash
   git clone https://github.com/mylo-james/MyloWare.git
   cd MyloWare
   python3.11 -m venv .venv
   source .venv/bin/activate
   pip install -e '.[dev]'
   cp .env.example .env
   ```
2. Boot local services (Postgres, Redis, API, Orchestrator, Prometheus, Grafana):
   ```bash
   make up
   ```
3. Apply migrations (if needed):
   ```bash
   alembic upgrade head
   ```
4. Validate environment:
   ```bash
   mw-py validate env
   ```

## Development Workflow

- **Observe → Diagnose → Fix → Verify → Document** (see `AGENTS.md`).
- Prefer the unified CLI (`mw-py`) over ad-hoc scripts.
- Keep changes small and scoped; avoid silent fallbacks—fail fast instead.

## Testing & Quality Gates

- Overall and per-package coverage must remain **≥80%** (target ~82%).
- Commands:
  - `make test` – unit tests (mock provider mode enforced)
  - `make test-coverage` – full suite with coverage gate
  - `make lint` – ruff + custom lint rule
- Any Python change that touches APIs, orchestrator nodes, or adapters must add/adjust:
  - At least one **unit test** under `tests/unit/**`
  - At least one **integration test** under `tests/integration/python_api/**` or related
- Live provider tests are opt-in (`@pytest.mark.live_smoke`). Run only when explicitly needed.

## Coding Standards

- Python 3.11+, type hints everywhere; keep lint clean (ruff).
- Structured logging (use existing helpers); no print debugging in committed code.
- Maintain persona/tool contracts—no silent fallbacks; raise clear errors instead.
- Keep adapters mock/live parity and enforce host allowlists and idempotency keys.

## Git & PRs

1. Create a feature branch from `main`.
2. Make changes with clear commits (present tense, imperative mood).
3. Run `make test-coverage` and `make lint` locally.
4. Update documentation when behaviour or interfaces change.
5. Open a PR with:
   - What changed and why
   - Testing performed (commands + results)
   - Any follow-up work or risk areas

## Reporting Issues

- Use GitHub issues with a minimal reproduction, expected vs. actual behaviour, and environment details.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
