# Backups and Restore (Postgres + pgvector)

**Audience:** Operations / platform engineers  
**Outcome:** Protect data and recover MyloWare from failures

---

## 1. Overview

MyloWare stores critical state in Postgres:

- `runs` – run lifecycle and status
- `artifacts` – persona outputs, notifications, and audit metadata
- `webhook_events` – provider webhooks (with signatures and raw payloads)
- `orchestration_checkpoints` – LangGraph state snapshots
- `hitl_approvals` – HITL approval audit trail
- `kb_documents`, `kb_embeddings` – RAG knowledge base
- `socials`, `project_socials` – publish targets per project

Backups must preserve enough information to:
- Rebuild run history for audit.
- Replay or recover provider-related state if needed.
- Restore the knowledge base and project configuration.

---

## 2. Retention and pruning

### 2.1 Application-level pruning

Use the Python CLI to prune old artifacts and webhooks:

```bash
export DB_URL=postgresql://postgres:postgres@localhost:5432/myloware
mw-py retention prune --dry-run
mw-py retention prune --artifacts-days 90 --webhooks-days 14
```

- Always run with `--dry-run` first in production.
- The command prints JSON counts suitable for ops notes.

### 2.2 Backup retention

Recommended minimums:

- Artifacts and checkpoints: 90 days
- Webhook payloads: 14 days
- Database backups: daily with at least 30 days of retention

Coordinate with your organization’s policies if stricter rules apply.

---

## 3. Manual backups

### 3.1 Full backup

```bash
pg_dump "$DB_URL" | gzip > backups/myloware_$(date +%Y%m%d).sql.gz
```

Store the archive in your usual backup bucket (S3/R2/etc.).

### 3.2 Table-focused backups

Critical tables:

```bash
pg_dump "$DB_URL" \
  -t runs \
  -t artifacts \
  -t webhook_events \
  -t hitl_approvals \
  > backups/myloware_core_$(date +%Y%m%d).sql
gzip backups/myloware_core_*.sql
```

Knowledge base tables (optional but recommended):

```bash
pg_dump "$DB_URL" \
  -t kb_documents \
  -t kb_embeddings \
  > backups/myloware_kb_$(date +%Y%m%d).sql
gzip backups/myloware_kb_*.sql
```

---

## 4. Automated backup script

Example daily backup script:

```bash
#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR=/backups/myloware
DATE=$(date +%Y%m%d_%H%M%S)
DB_URL=${DB_URL:-postgresql://postgres:postgres@localhost:5432/myloware}

mkdir -p "$BACKUP_DIR"

# Full backup
pg_dump "$DB_URL" | gzip > "$BACKUP_DIR/full_${DATE}.sql.gz"

# Core tables only
pg_dump "$DB_URL" \
  -t runs \
  -t artifacts \
  -t webhook_events \
  -t hitl_approvals \
  | gzip > "$BACKUP_DIR/core_${DATE}.sql.gz"

# Keep last 30 days
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +30 -delete
```

Cron example:

```bash
0 2 * * * /path/to/backup-db.sh
```

---

## 5. Restore procedures

### 5.1 Full restore (single environment)

1. Stop services:
   ```bash
   docker compose -f infra/docker-compose.yml down
   ```
2. Restore:
   ```bash
   gunzip -c backups/myloware_20251110.sql.gz | psql "$DB_URL"
   ```
3. Apply migrations to catch up:
   ```bash
   alembic upgrade head
   ```
4. Restart services:
   ```bash
   docker compose -f infra/docker-compose.yml up -d
   ```
5. Verify:
   ```bash
   curl -sS http://localhost:8080/health | jq .
   ```

### 5.2 Core tables only

If configuration is intact but run history is corrupted:

```bash
gunzip -c backups/myloware_core_20251110.sql.gz | psql "$DB_URL"
```

Verify:

```bash
psql "$DB_URL" -c "
  SELECT COUNT(*) AS runs FROM runs;
"
```

---

## 6. Disaster recovery drill

### 6.1 Staging restore test

1. Create a test database:
   ```bash
   createdb myloware_restore_test
   ```
2. Restore a recent backup:
   ```bash
   gunzip -c backups/myloware_20251110.sql.gz | \
     psql postgresql://postgres:postgres@localhost:5432/myloware_restore_test
   ```
3. Verify key tables:
   ```bash
   psql postgresql://postgres:postgres@localhost:5432/myloware_restore_test -c "
     SELECT
       (SELECT COUNT(*) FROM runs) AS runs,
       (SELECT COUNT(*) FROM artifacts) AS artifacts,
       (SELECT COUNT(*) FROM webhook_events) AS webhooks;
   "
   ```
4. Drop the test database when done:
   ```bash
   dropdb myloware_restore_test
   ```

---

## 7. Monitoring backups

### 7.1 Backup presence and size

```bash
ls -lt /backups/myloware | head -5
du -sh /backups/myloware/*.sql.gz
```

### 7.2 Integrity checks

```bash
gunzip -t /backups/myloware/full_latest.sql.gz
gunzip -c /backups/myloware/full_latest.sql.gz | head -20
```

Add a simple alert in your backup script:

```bash
if [ $? -ne 0 ]; then
  echo "Backup failed!" | mail -s "MyloWare Backup Alert" ops@example.com
fi
```

---

## 8. Best practices

1. Test restores regularly (at least quarterly).
2. Keep backups in multiple locations (local + cloud).
3. Encrypt backups at rest and in transit.
4. Document where backups live and how to restore them.
5. Combine DB backups with application-level pruning (`mw-py retention prune`).

