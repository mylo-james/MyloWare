# Production Deployment Guide

Complete guide for deploying MCP Prompts V2 to production.

## Related Guides

- [Security Hardening](./security-hardening.md) – Lock down CORS, hosts, keys, and HITL
- [Production Runbook](./production-runbook.md) – Day-2 operations, incident response
- [Troubleshooting](./troubleshooting.md) – Common failure scenarios

---

## Prerequisites

- Docker & Docker Compose (or Kubernetes)
- Domain name with SSL certificate
- OpenAI API key
- PostgreSQL 15+ with pgvector extension (or use managed service)
- n8n instance (self-hosted or cloud)
- Optional: Telegram bot token

---

## Step 1: Environment Setup

### 1.1 Clone Repository

```bash
git clone https://github.com/yourusername/mcp-prompts
cd mcp-prompts
```

### 1.2 Create Production Environment File

```bash
cp .env.example .env.production
```

Edit `.env.production` with production values:

```bash
# Database
DATABASE_URL=postgresql://user:password@prod-db:5432/mcp_prompts

# OpenAI
OPENAI_API_KEY=sk-your-production-key

# MCP Server
MCP_AUTH_KEY=$(openssl rand -hex 16)  # Generate secure key
SERVER_PORT=3000
SERVER_HOST=0.0.0.0

# n8n
N8N_BASE_URL=https://n8n.yourdomain.com
N8N_API_KEY=your-n8n-api-key

# Security
ALLOWED_CORS_ORIGINS=https://yourdomain.com,https://n8n.yourdomain.com
ALLOWED_HOST_KEYS=127.0.0.1,localhost,mcp.yourdomain.com
DEBUG_AUTH=false
RATE_LIMIT_MAX=100
RATE_LIMIT_TIME_WINDOW=1 minute

# Optional: Telegram
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
TELEGRAM_USER_ID=your-user-id

# Logging
LOG_LEVEL=info
```

---

## Step 2: Database Setup

### 2.1 Create Production Database

```bash
# Using managed PostgreSQL (recommended)
# Create database via provider UI, then run migrations

# Or using Docker
docker run -d \
  --name mcp-postgres \
  -e POSTGRES_DB=mcp_prompts \
  -e POSTGRES_USER=mcp_user \
  -e POSTGRES_PASSWORD=$(openssl rand -base64 32) \
  -v mcp-postgres-data:/var/lib/postgresql/data \
  pgvector/pgvector:pg16
```

### 2.2 Run Migrations

The database uses a single squashed migration (`drizzle/0000_initial_schema.sql`) that includes all schema, foreign keys, triggers, constraints, and indexes.

```bash
export DATABASE_URL=postgresql://user:password@prod-db:5432/mcp_prompts
npm run db:migrate
```

**Migration Policy:**
- Single squashed migration approach (no incremental migrations)
- Legacy migrations archived in `drizzle/archive/`
- Schema changes require updating the squashed migration file
- See `docs/DATABASE_SCHEMA.md` for complete schema reference

**For Local Development:**
After pulling changes that modify the schema, reset your local database:
```bash
npm run db:reset -- --force  # Requires --force flag for safety
npm run db:bootstrap -- --seed  # Reset + migrate + seed
```

### 2.3 Seed Initial Data

```bash
# Seed personas and projects
npm run migrate:personas
npm run migrate:projects

# Seed workflows (after n8n workflows are imported)
npm run db:seed:workflows
```

---

## Step 3: Update Workflow URLs

**Important:** n8n Cloud does not support `$env.*` interpolation inside workflow JSON, so every AI Agent node needs literal URLs. Before production deployment:

1. Edit the universal workflow `workflows/myloware-agent.workflow.json`.
   - Update the MCP Client node `endpointUrl` to your production MCP server (e.g., `https://mcp.yourdomain.com/mcp`).
   - Verify any HTTP Request nodes (video generation/editing/publishing) point at the production integrations.

2. Re-import workflows so n8n picks up the new URLs:
   ```bash
   npm run import:workflows
   ```

---

## Step 4: Deploy MCP Server

### Option A: Docker Compose (Recommended)

```bash
# Update docker-compose.yml with production URLs
# Set environment variables in .env.production

docker compose -f docker-compose.prod.yml up -d
```

### Option B: Kubernetes

```yaml
# Example deployment (create k8s manifests)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mcp-server
spec:
  replicas: 2
  template:
    spec:
      containers:
      - name: mcp-server
        image: your-registry/mcp-prompts:latest
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: mcp-secrets
              key: database-url
        - name: OPENAI_API_KEY
          valueFrom:
            secretKeyRef:
              name: mcp-secrets
              key: openai-api-key
```

---

## Step 5: Configure Reverse Proxy

### Using Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name mcp.yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Health check endpoint
    location /health {
        proxy_pass http://localhost:3000/health;
        access_log off;
    }

    # Metrics endpoint (restrict access)
    location /metrics {
        allow 10.0.0.0/8;  # Internal network only
        deny all;
        proxy_pass http://localhost:3000/metrics;
    }
}
```

### Using Cloudflare Tunnel

Update `cloudflared/config.prompts.yml` with production configuration. The example below mirrors the tunnel layout we ship in this repo and layers in QUIC transport, plus a TCP ingress for Postgres so you can reach the database through Cloudflare Access.

```yaml
tunnel: your-tunnel-id
credentials-file: /etc/cloudflared/credentials/mcp-vector.json
protocol: quic

ingress:
  - hostname: mcp.yourdomain.com
    service: http://mcp-server:3456
    originRequest:
      connectTimeout: 10s
      tcpKeepAlive: 30s
      noTLSVerify: false
      disableChunkedEncoding: false
      httpHostHeader: mcp-server:3456
  - hostname: n8n.yourdomain.com
    service: http://n8n:5678
  - hostname: db.yourdomain.com
    service: tcp://postgres:5432
  - service: http_status:404
```

Validate the config before restarting Cloudflared to catch typos early ([Context7 – cloudflared](https://context7.com/cloudflare/cloudflared/llms.txt)):

```bash
cloudflared tunnel ingress validate
```

---

## Step 6: Register Workflows

### 6.1 Import Workflows to n8n

```bash
npm run import:workflows
```

Copy the workflow IDs from output.

### 6.2 Register in Database

```bash
# Set environment variables with n8n workflow IDs
export N8N_WORKFLOW_ID_IDEAS=<id-from-import>
export N8N_WORKFLOW_ID_SCRIPT=<id-from-import>
export N8N_WORKFLOW_ID_VIDEO=<id-from-import>
export N8N_WORKFLOW_ID_TIKTOK=<id-from-import>

# Seed workflows with n8n IDs
npm run db:seed:workflows

# Or register manually
REGISTER_WORKFLOWS=true npm run import:workflows
```

---

## Step 7: Verify Deployment

### 7.1 Health Checks

```bash
# Check MCP server health
curl https://mcp.yourdomain.com/health

# Expected response:
{
  "status": "healthy",
  "timestamp": "2025-11-05T...",
  "service": "mcp-server",
  "checks": {
    "database": "ok",
    "openai": "ok",
    "tools": "..."
  }
}
```

### 7.2 Test MCP Endpoint

```bash
curl -X POST https://mcp.yourdomain.com/mcp \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-auth-key" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/list",
    "id": 1
  }'
```

### 7.3 Test a Tool Call

```bash
curl -X POST https://mcp.yourdomain.com/mcp \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-auth-key" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "memory_search",
      "arguments": {
        "query": "aismr specs",
        "limit": 1
      }
    },
    "id": 1
  }'
```

### 7.4 Connect to Postgres through the tunnel

Use Cloudflare Access TCP mode to expose the database locally without opening public inbound ports:

```bash
cloudflared access tcp --hostname db.yourdomain.com --url localhost:5432
```

The command binds `localhost:5432` on your workstation and relays traffic through the tunnel to the Docker `postgres` service.

---

## Step 8: Monitoring & Alerting

### 8.1 Prometheus Metrics

Metrics are available at `/metrics` endpoint:

```bash
curl https://mcp.yourdomain.com/metrics
```

Key metrics:
- `mcp_tool_calls_total` - Total tool calls
- `mcp_tool_call_duration_seconds` - Tool execution time
- `workflow_executions_total` - Workflow executions
- `workflow_duration_seconds` - Workflow execution time

### 8.2 Logging

Logs are structured JSON. Set up log aggregation:

```bash
# Using Loki/Promtail
# Configure log shipping to your logging service

# Or use Docker logging driver
docker run --log-driver=syslog ...
```

### 8.3 Health Check Monitoring

Set up monitoring to check `/health` endpoint every 30 seconds:

```yaml
# Prometheus scrape config
scrape_configs:
  - job_name: 'mcp-server'
    metrics_path: '/metrics'
    static_configs:
      - targets: ['mcp.yourdomain.com:443']
```

---

## Step 9: Backup & Restore

### 9.1 Database Backup

```bash
# Automated backup script
#!/bin/bash
BACKUP_DIR=/backups/mcp-prompts
DATE=$(date +%Y%m%d_%H%M%S)

pg_dump $DATABASE_URL > $BACKUP_DIR/backup_$DATE.sql

# Keep last 30 days
find $BACKUP_DIR -name "backup_*.sql" -mtime +30 -delete
```

### 9.2 Restore Database

```bash
psql $DATABASE_URL < backup_20251105_120000.sql
```

### 9.3 Verify Workflow Metadata Backups

Procedural memories now contain the `n8nWorkflowId` inside their metadata. Ensure your database backups include the `memories` table so those mappings can be restored:

```bash
pg_dump $DATABASE_URL -t memories > memories_backup.sql
```

---

## Step 10: Security Checklist

- [ ] MCP_AUTH_KEY is set and secure (use strong random value)
- [ ] Database credentials are secure (not in code)
- [ ] Rate limiting is enabled (100 req/min default)
- [ ] CORS is configured (only allow trusted origins)
- [ ] Helmet security headers are enabled
- [ ] SSL/TLS is configured (HTTPS only)
- [ ] API keys are stored in secrets manager
- [ ] Logs don't contain sensitive data
- [ ] Health endpoint is accessible (no auth required)
- [ ] Metrics endpoint is restricted (internal only)

---

## Step 11: Scaling

### Horizontal Scaling

The MCP server is stateless and can be scaled horizontally:

```bash
# Run multiple instances behind load balancer
docker compose scale mcp-server=3
```

### Database Scaling

- Use connection pooling (already configured)
- Consider read replicas for heavy read workloads
- Monitor connection pool usage

### n8n Scaling

- n8n can run multiple workers
- Configure queue system for distributed execution
- Monitor workflow execution queue

---

## Troubleshooting

See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for common issues.

---

## Rollback Procedure

If deployment fails:

1. **Rollback Database:**
   ```bash
   # Restore from backup
   psql $DATABASE_URL < backup_before_deployment.sql
   ```

2. **Rollback Code:**
   ```bash
   # Revert to previous version
   git checkout previous-stable-tag
   docker compose build
   docker compose up -d
   ```

3. **Rollback Workflows:**
   ```bash
   # Re-import previous workflow versions
   npm run import:workflows
   ```

---

## Maintenance

### Regular Tasks

- **Daily:** Monitor health checks and error logs
- **Weekly:** Review metrics and performance
- **Monthly:** Update dependencies and security patches
- **Quarterly:** Review and optimize database indices

### Updates

```bash
# Pull latest code
git pull origin main

# Run migrations
npm run db:migrate

# Rebuild and restart
docker compose build
docker compose up -d

# Verify deployment
curl https://mcp.yourdomain.com/health
```

---

## Support

For issues or questions:
- Check [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
- Review logs: `docker compose logs mcp-server`
- Check metrics: `curl https://mcp.yourdomain.com/metrics`
