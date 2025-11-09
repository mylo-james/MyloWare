# Release Cut and Rollback

**Audience:** DevOps, release managers  
**Outcome:** Safe production deployments with rollback capability  
**Time:** 15-30 minutes per release

---

## Overview

MyloWare uses a simple release process:
1. Tag release in git
2. Run migrations
3. Deploy services
4. Verify health
5. Rollback if needed

---

## Prerequisites

- Production access
- Database backup recent (< 1 hour old)
- All tests passing in CI
- Staging deployment successful

---

## Release Process

### 1. Pre-Release Checklist

- [ ] All tests passing: `npm test`
- [ ] Coverage ≥50%: `npm run test:coverage`
- [ ] No linter errors: `npm run lint`
- [ ] Type check passes: `npm run type-check`
- [ ] Legacy tools check passes: `npm run check:legacy-tools`
- [ ] Docs links valid: `npm run docs:check-links`
- [ ] Staging deployment successful

### 2. Create Release Tag

```bash
# Pull latest
git checkout main
git pull origin main

# Create tag
git tag -a v2.1.0 -m "Release v2.1.0: Universal workflow improvements"

# Push tag
git push origin v2.1.0
```

### 3. Backup Database

```bash
# Create pre-release backup
pg_dump $DATABASE_URL > backup_pre_v2.1.0_$(date +%Y%m%d).sql

# Compress
gzip backup_pre_v2.1.0_*.sql

# Verify
gunzip -t backup_pre_v2.1.0_*.sql.gz
```

### 4. Run Migrations

```bash
# Check migration status
npm run db:status

# Apply migrations
npm run db:migrate

# Verify schema
psql $DATABASE_URL -c "\dt"
```

### 5. Deploy Services

```bash
# Pull latest code
git pull origin main

# Build new images
docker compose build

# Restart services
docker compose up -d

# Wait for startup
sleep 10
```

### 6. Verify Deployment

```bash
# Check health
curl https://mcp-vector.mjames.dev/health

# Expected response
{
  "status": "healthy",
  "checks": {
    "database": "ok",
    "openai": "ok"
  }
}

# Check version
curl https://mcp-vector.mjames.dev/version

# Test tool call
curl -X POST https://mcp-vector.mjames.dev/mcp \
  -H "X-API-Key: $MCP_AUTH_KEY" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

### 7. Smoke Test

```bash
# Run E2E test against production
npm run test:e2e:live
```

---

## Rollback Process

### When to Rollback

Rollback if:
- Health check fails
- Critical functionality broken
- Database errors
- E2E tests fail

### Rollback Steps

#### 1. Stop Services

```bash
docker compose down
```

#### 2. Restore Database

```bash
# Restore from pre-release backup
gunzip -c backup_pre_v2.1.0_*.sql.gz | psql $DATABASE_URL
```

#### 3. Revert Code

```bash
# Checkout previous tag
git checkout v2.0.0

# Rebuild
docker compose build
```

#### 4. Restart Services

```bash
docker compose up -d
```

#### 5. Verify Rollback

```bash
# Check health
curl https://mcp-vector.mjames.dev/health

# Check version
curl https://mcp-vector.mjames.dev/version

# Should show v2.0.0
```

---

## Migration Rollback

### Test Rollback Safety

Before deploying migrations, test rollback:

```bash
npm run db:test:rollback
```

This:
1. Spins up ephemeral database
2. Applies migrations
3. Drops schema
4. Re-applies migrations
5. Verifies success

### Manual Rollback

If migrations fail in production:

```bash
# Restore database from backup
psql $DATABASE_URL < backup_pre_release.sql

# Verify schema
psql $DATABASE_URL -c "\dt"

# Verify data
psql $DATABASE_URL -c "SELECT COUNT(*) FROM memories"
```

---

## Validation

✅ Health check returns "healthy"  
✅ Version matches release tag  
✅ Tools list returns expected tools  
✅ E2E tests pass  
✅ No errors in logs

---

## Post-Release

### 1. Monitor

```bash
# Watch logs
docker compose logs -f mcp-server

# Watch metrics
curl https://mcp-vector.mjames.dev/metrics | grep error
```

### 2. Verify Traces

```bash
# Check active traces
psql $DATABASE_URL -c "
  SELECT trace_id, current_owner, status 
  FROM execution_traces 
  WHERE status = 'active'
"
```

### 3. Document Release

Update `CHANGELOG.md`:

```markdown
## [2.1.0] - 2025-01-09

### Added
- Universal workflow improvements
- New persona: Morgan (Sound Designer)

### Fixed
- Handoff race conditions
- Memory tagging validation

### Changed
- Consolidated documentation structure
```

---

## Rollback Decision Matrix

| Issue | Severity | Action |
|-------|----------|--------|
| Health check fails | Critical | Immediate rollback |
| E2E tests fail | Critical | Immediate rollback |
| Minor feature broken | Medium | Fix forward or rollback |
| Performance degradation | Medium | Monitor, rollback if worsens |
| UI glitch | Low | Fix forward |

---

## Next Steps

- [Deployment Guide](../05-operations/deployment.md) - Production setup
- [Backups and Restore](../05-operations/backups-and-restore.md) - Data protection
- [Observability](../05-operations/observability.md) - Monitoring

---

## Troubleshooting

**Migration fails?**
- Check database connection
- Verify schema compatibility
- Review migration SQL
- Restore from backup if needed

**Services won't start?**
- Check Docker logs: `docker compose logs`
- Verify environment variables
- Check port conflicts

**Rollback fails?**
- Restore from backup manually
- Verify backup integrity
- Check database permissions

See [Troubleshooting Guide](../05-operations/troubleshooting.md) for more help.

