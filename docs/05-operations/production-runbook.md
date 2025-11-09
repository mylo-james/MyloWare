# Production Runbook

**Last Updated:** 2025-11-09  
**Version:** 1.0

---

## Overview

Operational checklist for running MyloWare in production: deployment prep, health checks, incident response, scaling, and recovery procedures.

---

## Pre-Deployment Checklist

### Environment Validation
- [ ] `DATABASE_URL` reachable
- [ ] `OPENAI_API_KEY` valid (test with `curl https://api.openai.com/v1/models`)
- [ ] `MCP_AUTH_KEY` set (32+ chars)
- [ ] `ALLOWED_CORS_ORIGINS` configured (no wildcards)
- [ ] `ALLOWED_HOST_KEYS` matches deployed hostnames
- [ ] `TELEGRAM_BOT_TOKEN` and webhook verified
- [ ] `N8N_WEBHOOK_URL` reachable

### Database Migrations
```bash
npm run db:migrate
psql $DATABASE_URL -c "\di idx_memories_trace_id"
```

### Health Checks
```bash
curl https://mcp.yourdomain.com/health | jq
curl https://mcp.yourdomain.com/metrics | grep http_requests_total
```

---

## Startup Procedure

1. **Load environment**
   ```bash
   source .env.production
   ```

2. **Migrate & seed (if needed)**
   ```bash
   npm run db:migrate
   npm run db:seed   # optional
   ```

3. **Start service**
   ```bash
   NODE_ENV=production npm start
   # or via PM2:
   pm2 start npm --name "myloware" -- start
   ```

4. **Verify**
   ```bash
   curl -f https://mcp.yourdomain.com/health
   curl -H "x-api-key: $MCP_AUTH_KEY" \
        https://mcp.yourdomain.com/mcp \
        -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
   ```

---

## Incident Response

### Trace Stuck in Active State
1. Detect:
   ```sql
   SELECT trace_id, current_owner, updated_at
   FROM execution_traces
   WHERE status = 'active'
     AND updated_at < NOW() - INTERVAL '30 minutes';
   ```
2. Inspect memory search:
   ```bash
   npm run mw -- memory search --trace-id <trace-id> --limit 20
   ```
3. Recover via manual handoff:
   ```bash
   npm run mw -- handoff --trace-id <trace-id> --to-agent <next-agent>
   ```
4. If unrecoverable, mark failed and notify owners.

### Memory Search Slow (>1s)
1. Confirm index usage:
   ```sql
   EXPLAIN ANALYZE
   SELECT * FROM memories
   WHERE trace_id = '<trace-id>'
   LIMIT 10;
   ```
2. If `Seq Scan`, run migrations or `ANALYZE memories;`.
3. Inspect `rate(memory_search_duration_seconds_bucket[5m])` in Prometheus.

### Handoff Webhook Failure
1. Verify n8n availability:
   ```bash
   curl -f $N8N_WEBHOOK_URL/health
   ```
2. Check MCP logs for webhook errors.
3. Retry handoff manually (`npm run mw -- handoff ...`).

### High Memory Usage
1. Inspect `docker stats` or `pm2 status`.
2. Tune session limits via `SESSION_TTL_MS` and `MAX_SESSIONS_PER_USER`.
3. Restart service and monitor.

---

## Scaling Guidelines

| Metric | Low | Medium | High |
|--------|-----|--------|------|
| Concurrent traces | 1-10 | 10-50 | 50-200 |
| Memory (GB) | 1-2 | 2-4 | 4-8 |
| CPU cores | 1-2 | 2-4 | 4-8 |
| DB connections | 10 | 20 | 50 |

### Horizontal Scaling
```bash
docker compose up -d --scale mcp-server=3
```
Use a load balancer (nginx/HAProxy) with sticky sessions disabled (stateless API).

### Caching Considerations
Add Redis when:
- Memory queries > 100 ms (p95)
- Active traces > 1000
- Embedding workloads spike

---

## Monitoring & Alerts

Key metrics:
1. **Trace success rate** – `rate(traces_completed_total[5m]) / rate(traces_created_total[5m])`
2. **Memory search latency** – `histogram_quantile(0.95, rate(memory_search_duration_seconds_bucket[5m]))`
3. **API error rate** – `rate(http_requests_total{status=~"5.."}[5m])`
4. **DB pool usage** – `db_connection_pool_in_use`

Alert thresholds:
- Trace success < 90%
- Memory search p95 > 500 ms
- API p95 > 2 s
- DB pool > 90% utilization

---

## Backup & Restore

### Daily Backups
```bash
pg_dump $DATABASE_URL | gzip > /backups/myloware/mcp_$(date +%Y%m%d).sql.gz
```

### Restore
1. Stop service.
2. Drop & recreate database.
3. Restore dump:
   ```bash
   gunzip -c /backups/myloware/mcp_20251109.sql.gz | psql $DATABASE_URL
   ```
4. Run `npm run db:migrate`.
5. Restart service.

---

## Rollback Procedure

### Application
```bash
pm2 stop myloware
git checkout <previous-tag>
npm install
pm2 start npm --name "myloware" -- start
```

### Database
```bash
npm run db:rollback
psql $DATABASE_URL -c "SELECT * FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1;"
```

---

## Support Contacts

- **Ops Lead:** ops@yourdomain.com
- **Database Admin:** dba@yourdomain.com
- **Security Team:** security@yourdomain.com
- **On-Call Pager:** <integration>

---

## Related Documents

- [Security Hardening](./security-hardening.md)
- [Deployment Guide](./deployment.md)
- [Troubleshooting](./troubleshooting.md)

