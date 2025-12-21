## Summary

- What changed and why
- Any user-facing behavior changes (CLI/API)
- Any safety/HITL implications

## Testing

- [ ] `make lint`
- [ ] `make type-check`
- [ ] `make test-fast`
- [ ] `make eval-dry` (required if prompts/agents/workflows/eval code changed)
- [ ] `make test-integration` (if DB/stack behavior changed)
- [ ] `make test-parity` / `make test-live` (only if explicitly needed)

## Notes

- Migration needed? If yes, add a new Alembic revision under `alembic/versions/` (do not edit existing migrations).
- Any new env vars/settings? Update docs and `.env.example`.
