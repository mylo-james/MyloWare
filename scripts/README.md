# Scripts Directory

⚠️ **Most scripts have been consolidated into the unified CLI (`mw-py`).**

## Using the CLI

The primary interface for MyloWare automation is the Python CLI:

```bash
mw-py --help                    # See all commands
mw-py validate env              # Check environment setup
mw-py demo aismr                # Run a demo workflow
mw-py runs watch <run_id>       # Watch a run in real-time
mw-py kb ingest --dir data/kb   # Ingest knowledge base
mw-py evidence <run_id>         # Collect run evidence
```

## Remaining Scripts

A small number of scripts remain for specialized purposes:

### Development Tools

- `dev/check_test_safety.py` - Pre-test validation (ensures mock mode)
- `dev/lint_no_direct_adapter_instantiation.py` - Custom lint rule
- `dev/print_run_evidence.py` - Library used by `mw-py evidence` command

### Infrastructure Scripts

Moved to `infra/scripts/` - see [infra/scripts/README.md](../infra/scripts/README.md)

## Migration from Legacy Scripts

| Old Script | New CLI Command |
|-----------|----------------|
| `scripts/watch_run.py` | `mw-py runs watch <run_id>` |
| `scripts/python/ingest_kb.py` | `mw-py kb ingest --dir <path>` |
| `scripts/dev/test_video_gen.py` | `mw-py demo test-video-gen` |
| `scripts/coverage_report.py` | `make test-coverage` |

## Why This Change?

- **Unified interface** - One command (`mw-py`) instead of dozens of scripts
- **Better discoverability** - `mw-py --help` shows all options
- **Consistent error handling** - All commands use same patterns
- **Easier testing** - CLI commands are unit-tested
