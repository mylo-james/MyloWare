## MyloWare CLI (mw)

The unified entrypoint for operational scripts. Mirrors the structure of our docs/data domains.

Usage:

```bash
npm run mw -- <group> <command> [-- args]
```

Groups and commands:

- env
  - use <dev|test|prod>
  - dev | test | prod
- dev
  - obs | summary | watch | validate
- db
  - reset | bootstrap | migrate | seed | status | test:rollback | setup:test | seed:test | seed:workflows
- workflows
  - import | pull | register | sync-ids | validate-ids | clear | watch | summary | dev:refresh
- n8n
  - dev | test | prod <args...>
- docs
  - generate | check-links | tools | schema
- ingest
  - data [-- --dry-run]
- migrate
  - personas | projects | workflows | all
- test
  - workflow [-- --fixture <name> | message...]
  - mcp
- watch
  - execution | latest
- validate
  - legacy
- ops
  - verify | setup

Examples:

```bash
npm run mw -- db reset
npm run mw -- workflows import
npm run mw -- ingest data -- --dry-run
npm run mw -- test workflow -- --fixture test-video-run
```

Notes:

- Commands are thin wrappers over existing scripts; legacy npm run targets continue to work.
- Over time, individual scripts will be refactored into callable modules and exposed via this CLI.


