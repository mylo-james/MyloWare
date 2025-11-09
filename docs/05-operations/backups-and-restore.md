# Backups and Restore

**Audience:** Operations team, DevOps  
**Outcome:** Protect data and recover from failures

---

## Overview

MyloWare stores critical data in PostgreSQL:
- **Memories** - Vector embeddings, content, metadata
- **Traces** - Production run state and history
- **Configuration** - Personas, projects, workflows

---

## Backup Strategy

### What to Back Up

**Critical (daily):**
- `memories` table - All memory content and embeddings
- `execution_traces` table - Production run history
- `agent_webhooks` table - Webhook configuration

**Important (weekly):**
- `personas` table - Agent configuration
- `projects` table - Project specs
- `sessions` table - Conversation state

**Optional (monthly):**
- `video_generation_jobs` table - Job history
- `edit_jobs` table - Edit history

---

## Automated Backup

### Daily Backup Script

```bash
#!/bin/bash
# scripts/backup-db.sh

BACKUP_DIR=/backups/myloware
DATE=$(date +%Y%m%d_%H%M%S)
DATABASE_URL=${DATABASE_URL:-postgresql://localhost:5432/mcp_v2}

# Create backup directory
mkdir -p $BACKUP_DIR

# Full database backup
pg_dump $DATABASE_URL > $BACKUP_DIR/full_$DATE.sql

# Critical tables only (faster restore)
pg_dump $DATABASE_URL \
  -t memories \
  -t execution_traces \
  -t agent_webhooks \
  > $BACKUP_DIR/critical_$DATE.sql

# Compress
gzip $BACKUP_DIR/full_$DATE.sql
gzip $BACKUP_DIR/critical_$DATE.sql

# Keep last 30 days
find $BACKUP_DIR -name "*.sql.gz" -mtime +30 -delete

echo "✓ Backup complete: $BACKUP_DIR"
```

### Cron Schedule

```bash
# Add to crontab
0 2 * * * /path/to/scripts/backup-db.sh
```

---

## Manual Backup

### Full Database

```bash
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d).sql
```

### Specific Tables

```bash
# Memories only
pg_dump $DATABASE_URL -t memories > memories_backup.sql

# Traces only
pg_dump $DATABASE_URL -t execution_traces > traces_backup.sql

# Configuration only
pg_dump $DATABASE_URL \
  -t personas \
  -t projects \
  -t agent_webhooks \
  > config_backup.sql
```

### With Compression

```bash
pg_dump $DATABASE_URL | gzip > backup_$(date +%Y%m%d).sql.gz
```

---

## Restore Procedures

### Full Restore

```bash
# Stop services
docker compose down

# Restore database
psql $DATABASE_URL < backup_20250109.sql

# Restart services
docker compose up -d

# Verify health
curl http://localhost:3456/health
```

### Partial Restore

```bash
# Restore specific table
psql $DATABASE_URL < memories_backup.sql

# Verify
psql $DATABASE_URL -c "SELECT COUNT(*) FROM memories;"
```

### From Compressed Backup

```bash
gunzip -c backup_20250109.sql.gz | psql $DATABASE_URL
```

---

## Disaster Recovery

### Complete System Failure

1. **Restore database from latest backup**
   ```bash
   psql $DATABASE_URL < backup_latest.sql
   ```

2. **Verify schema**
   ```bash
   psql $DATABASE_URL -c "\dt"
   ```

3. **Check critical tables**
   ```bash
   psql $DATABASE_URL -c "
     SELECT 
       (SELECT COUNT(*) FROM memories) as memories,
       (SELECT COUNT(*) FROM execution_traces) as traces,
       (SELECT COUNT(*) FROM personas) as personas,
       (SELECT COUNT(*) FROM projects) as projects;
   "
   ```

4. **Restart services**
   ```bash
   docker compose up -d
   ```

5. **Verify health**
   ```bash
   curl http://localhost:3456/health
   ```

6. **Test end-to-end**
   ```bash
   npm run test:e2e
   ```

---

### Partial Data Loss

**Lost memories only:**
```bash
psql $DATABASE_URL < memories_backup.sql
```

**Lost traces only:**
```bash
psql $DATABASE_URL < traces_backup.sql
```

**Lost configuration only:**
```bash
# Restore from backup
psql $DATABASE_URL < config_backup.sql

# Or re-seed
npm run migrate:personas
npm run migrate:projects
npm run db:seed:workflows
```

---

## Backup Verification

### Test Restore (Staging)

```bash
# Create test database
createdb mcp_v2_restore_test

# Restore backup
psql postgresql://localhost:5432/mcp_v2_restore_test < backup_latest.sql

# Verify counts match production
psql postgresql://localhost:5432/mcp_v2_restore_test -c "
  SELECT COUNT(*) FROM memories;
"

# Drop test database
dropdb mcp_v2_restore_test
```

### Backup Integrity Check

```bash
# Check backup file size
ls -lh backup_latest.sql.gz

# Verify not corrupt
gunzip -t backup_latest.sql.gz

# Check SQL validity
gunzip -c backup_latest.sql.gz | head -100
```

---

## Retention Policy

**Production:**
- Daily backups: Keep 30 days
- Weekly backups: Keep 12 weeks
- Monthly backups: Keep 12 months

**Development:**
- Daily backups: Keep 7 days
- No weekly/monthly retention

---

## Cloud Backup

### S3/R2 Upload

```bash
#!/bin/bash
# Upload to S3/R2

BACKUP_FILE=backup_$(date +%Y%m%d).sql.gz
S3_BUCKET=s3://myloware-backups

# Create backup
pg_dump $DATABASE_URL | gzip > $BACKUP_FILE

# Upload
aws s3 cp $BACKUP_FILE $S3_BUCKET/

# Verify
aws s3 ls $S3_BUCKET/$BACKUP_FILE

# Clean up local
rm $BACKUP_FILE
```

### Automated Cloud Sync

```bash
# Add to backup script
aws s3 sync $BACKUP_DIR $S3_BUCKET/ \
  --exclude "*" \
  --include "*.sql.gz" \
  --storage-class STANDARD_IA
```

---

## Monitoring

### Backup Success

```bash
# Check last backup
ls -lt /backups/myloware | head -5

# Verify backup size
du -sh /backups/myloware/backup_latest.sql.gz
```

### Alert on Failure

```bash
# Add to backup script
if [ $? -ne 0 ]; then
  echo "Backup failed!" | mail -s "MyloWare Backup Alert" ops@example.com
fi
```

---

## Recovery Time Objectives (RTO)

| Scenario | Target RTO | Procedure |
|----------|-----------|-----------|
| Database corruption | < 15 minutes | Restore from latest backup |
| Accidental deletion | < 5 minutes | Restore specific table |
| Complete system failure | < 30 minutes | Full restore + service restart |
| Configuration loss | < 5 minutes | Re-seed from data/ directory |

---

## Best Practices

1. **Test restores regularly** - Monthly restore test to staging
2. **Verify backups** - Check integrity and size after each backup
3. **Multiple locations** - Local + cloud storage
4. **Encrypt backups** - Use encryption at rest and in transit
5. **Document procedures** - Keep this guide updated
6. **Monitor backup jobs** - Alert on failures
7. **Version backups** - Keep multiple versions, not just latest

---

## Troubleshooting

**Backup fails with "disk full"?**
- Clean old backups: `find $BACKUP_DIR -mtime +30 -delete`
- Increase disk space
- Use compression: `pg_dump | gzip`

**Restore fails with "relation already exists"?**
- Drop database first: `dropdb mcp_v2 && createdb mcp_v2`
- Or use `--clean` flag: `pg_dump --clean`

**Backup too large?**
- Exclude job history: `pg_dump --exclude-table=video_generation_jobs`
- Compress: `pg_dump | gzip`
- Use incremental backups (WAL archiving)

---

## Further Reading

- [Deployment Guide](deployment.md) - Production setup
- [Troubleshooting](troubleshooting.md) - Common issues
- [Observability](observability.md) - Monitoring
- [Data Model](../02-architecture/data-model.md) - Schema details

