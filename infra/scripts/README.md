# Infrastructure Scripts

These scripts are for bootstrapping, deployment, and operational tasks that must run outside the main CLI.

## Scripts

### `bootstrap_staging_secrets.sh`
**Purpose:** Sync secrets from `.env` to Fly.io apps (API + Orchestrator)  
**When to use:** After updating secrets in `.env` or `.env.real`  
**Usage:**
```bash
bash infra/scripts/bootstrap_staging_secrets.sh
```

### `migrate_staging.sh`
**Purpose:** Run Alembic migrations against staging database  
**When to use:** After creating new migrations with `alembic revision`  
**Usage:**
```bash
bash infra/scripts/migrate_staging.sh
```
Also available via: `make migrate-staging`

### `materialize_env.py`
**Purpose:** Snapshot 1Password pipe (`.env.real`) into regular `.env` file  
**When to use:** When `.env.real` is a named pipe and you need a static copy  
**Usage:**
```bash
python infra/scripts/materialize_env.py --src .env.real --dest .env
```

## Why These Are Here

These scripts handle infrastructure bootstrapping that happens *before* the Python environment is fully set up, or require shell scripting for environment manipulation. All other automation should use the unified CLI (`mw-py`).
