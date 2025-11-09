### MyloWare Scripts (Unified via `mw`)

Use the CLI to access all operational tasks:

```bash
npm run mw -- <group> <command> [-- args]
```

Quick map (old → new):

- npm run ingest-data → `mw ingest data`
- npm run db:reset → `mw db reset`
- npm run db:migrate → `mw db migrate`
- npm run db:seed → `mw db seed`
- npm run migrate:all → `mw migrate all`
- npm run workflows:pull → `mw workflows pull`
- npm run import:workflows → `mw workflows import`
- npm run register:workflows → `mw workflows register`
- npm run sync:n8n-ids → `mw workflows sync-ids`
- npm run validate:n8n-ids → `mw workflows validate-ids`
- npm run workflow:dev:summary → `mw workflows summary`
- npm run workflow:dev:watch → `mw workflows watch`
- npm run dev:obs → `mw dev obs`
- npm run docs:generate → `mw docs generate`
- npm run docs:check-links → `mw docs check-links`
- npm run test:mcp → `mw test mcp`
- npm run watch:execution → `mw watch execution`
- (and more – see `npm run mw -- help`)

Legacy npm scripts remain for now; prefer the CLI going forward.


