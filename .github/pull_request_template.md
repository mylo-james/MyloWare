## Summary

- Provide a short description of the change and which story it advances.

## Testing

- [ ] `TEST_DB_USE_CONTAINER=1 LOG_LEVEL=warn npx vitest run tests/unit`
- [ ] Additional commands (list any focused suites you ran)

## Pre-merge Checklist

- [ ] `npm run db:test:rollback` (required whenever migrations or seeds change — paste results or mark N/A if no schema changes)
- [ ] Noted any schema-impacting files in the PR description

> Tip: the rollback smoke test should pass before requesting review. If you skipped it because there were no migrations, state “No migration changes” explicitly.
