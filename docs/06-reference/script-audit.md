## Script Audit (Initial Pass)

This audit classifies all scripts and maps them into the new unified CLI (`npm run mw -- ...`). Items not referenced by `package.json` or docs are marked for deprecation review.

Legend:
- Keep: actively used or now wired into CLI
- Review: useful but previously unreferenced; now available via CLI
- Deprecate: redundant or superseded; propose removal or migration

### scripts/ (TypeScript and shell)

- Keep
  - `check-deprecated-tools.ts` → mw validate legacy
  - `check-docs-links.ts` → mw docs check-links
  - `db/bootstrap.ts` → mw db bootstrap
  - `db/migrate.ts` → handled by mw db migrate (drizzle-kit push)
  - `db/reset.ts` → mw db reset
  - `db/seed.ts` → mw db seed
  - `db/seed-test.ts` → mw db seed:test
  - `db/seed-workflows.ts` → mw db seed:workflows
  - `db/setup-test-db.ts` → mw db setup:test
  - `db/test-rollback.ts` → mw db test:rollback
  - `dev/obs.sh` → mw dev obs
  - `dev/print-dev-summary.ts` → mw dev summary (also workflows summary)
  - `dev/watch-workflows.ts` → mw dev watch (also workflows watch)
  - `env-manager.sh` → mw env dev|test|prod; mw env use <env> delegates to existing npm scripts
  - `generate-docs.ts` → mw docs generate|tools|schema
  - `import-workflows.ts` → mw workflows import
  - `ingest-data.ts` → mw ingest data
  - `migrate/personas.ts` → mw migrate personas
  - `migrate/projects.ts` → mw migrate projects
  - `migrate/workflows.ts` → mw migrate workflows
  - `n8n-cli.sh` → mw n8n dev|test|prod
  - `register-workflow-mappings.ts` → mw workflows register
  - `run-workflow-test.ts` → mw test workflow
  - `sync-n8n-workflow-ids.ts` → mw workflows sync-ids
  - `test-mcp-tools.ts` → mw validate legacy (kept as separate command via npm run test:mcp)
  - `validate-dev-env.sh` → kept via npm run dev:validate (candidate for `mw dev validate`)
  - `validate-workflow-ids.ts` → mw workflows validate-ids
  - `watch-execution.ts` → mw watch execution|latest
  - `workflows-pull.ts` → mw workflows pull

- Review
  - `clear-n8n-workflows.ts` → Now exposed as `mw workflows clear`; previously unreferenced but useful for clean-room setups.
  - `verify-deployment.sh` → Now exposed as `mw ops verify`; referenced in `setup-n8n.sh` but not in npm scripts.

- Deprecate (proposed)
  - `setup-and-start.sh` → Redundant with documented flows and `mw ops verify` + `dev:services:*`. Recommend removal and folding any missing instructions into docs/05-operations/deployment.md.

### Top-level shell scripts

- Keep
  - `start-dev.sh` → Developer convenience; complements `npm run dev` and `dev:services:*`.
  - `setup-n8n.sh` → Guided manual setup; referenced by `mw ops setup`.

- Review
  - `test-n8n-style-call.sh` → Ad hoc testing; consider moving under `scripts/dev/` or replacing with `mw test workflow`.
  - `test-mcp-response.sh` → Same as above.
  - `test-full-mcp-flow.sh` → Same as above.

### Follow-ups

- Add `mw dev validate` → wrap `scripts/validate-dev-env.sh`.
- Decide on migrating top-level test shells into `scripts/dev/` or documenting via `mw test workflow`.
- If approved, delete `scripts/setup-and-start.sh` and update deployment docs to cover any missing steps.


