# Security Hardening Guide

**Last Updated:** 2025-11-09  
**Version:** 1.0

---

## Overview

This guide provides production hardening steps for deploying MyloWare. Follow these controls to protect the MCP endpoint, prevent unauthorized access, and keep credentials fresh.

---

## Required Environment Variables

### CORS Configuration

**Variable:** `ALLOWED_CORS_ORIGINS`  
**Format:** Comma-separated list of origins  
**Default:** Empty (fail-closed)

```bash
ALLOWED_CORS_ORIGINS=https://n8n.yourdomain.com,https://app.yourdomain.com
```

**Why:** Only trusted frontends (n8n, admin apps) should reach the MCP HTTP endpoint. Leaving this empty rejects every cross-origin request, preventing drive-by abuse during bootstrap.

### Host Allowlist

**Variable:** `ALLOWED_HOST_KEYS`  
**Format:** Comma-separated hostnames/IPs  
**Default:** `127.0.0.1,localhost,mcp-server`

```bash
ALLOWED_HOST_KEYS=127.0.0.1,localhost,mcp-server,mcp.yourdomain.com
```

**Why:** Enforces DNS rebinding protection at the transport layer. Ports are added automatically, so listing the base host is enough.

### Authentication Keys

**Variable:** `MCP_AUTH_KEY`  
**Format:** 32+ character random string  
**Default:** None (required in production)

```bash
MCP_AUTH_KEY=$(openssl rand -hex 32)
```

Never commit keys or share them via chat. Use a secrets manager (AWS Secrets Manager, Vault, Doppler, etc.).

### Debug Logging

**Variable:** `DEBUG_AUTH`  
**Format:** `true` or `false`  
**Default:** `false`

Set to `true` only during local debugging. When disabled, authentication failures only log request metadata—no hashes or lengths leak to logs.

### Rate Limiting

**Variables:**

```bash
RATE_LIMIT_MAX=100
RATE_LIMIT_TIME_WINDOW=1 minute
```

Tune per environment. Example: staging = 500/min, production = 1000/min.

---

## Key Rotation Procedures

### Rotate MCP Auth Key

1. Generate a new key:
   ```bash
   NEW_KEY=$(openssl rand -hex 32)
   ```
2. Update n8n credentials first (HTTP nodes calling MCP).
3. Update server secrets (`MCP_AUTH_KEY=$NEW_KEY`) and restart the service.
4. Verify:
   ```bash
   curl -H "x-api-key: $NEW_KEY" https://mcp.yourdomain.com/health
   ```
5. Monitor logs for residual unauthorized attempts.

### Rotate Database Credentials

1. Create a new database user with the required grants.
2. Update `DATABASE_URL` in secrets store.
3. Restart MCP service (and any workers).
4. Grace period 24h before dropping the old user.

---

## Human-in-the-Loop Controls

### Telegram Approval Flow

MyloWare workflows pause at critical checkpoints (e.g., Casey approving modifiers) and wait for Telegram confirmation.

1. Send summary via Telegram node.
2. Wait for `/approve trace-123` via webhook (15 min timeout).
3. On timeout: notify on-call, mark trace as `pending_approval`.

Test the flow:

```bash
curl -X POST https://n8n.yourdomain.com/webhook/myloware/ingest \
  -H "x-api-key: $N8N_WEBHOOK_AUTH_TOKEN" \
  -d '{"traceId": "test-trace-001", "instructions": "Make AISMR video"}'
```

---

## Network Security

### Firewall Rules

**Inbound**
```bash
ufw allow from <n8n-ip> to any port 443 proto tcp
ufw allow from <mcp-ip> to any port 5432 proto tcp
```

**Outbound**
```bash
ufw allow out to any port 443 proto tcp   # OpenAI, webhooks
```

### TLS Configuration (nginx example)

```nginx
ssl_protocols TLSv1.3;
ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256';
add_header Strict-Transport-Security "max-age=63072000" always;
```

---

## Tool Security

### API Key Management

- `/mcp` and `/tools/:toolName` require the `X-API-Key` header (`MCP_AUTH_KEY`)
- Store the key in n8n credentials and your secret manager (never in workflow nodes)
- Rotate the key alongside the MCP endpoint credentials (see “Key Rotation Procedures”)

### Persona-Based Tool Gating

- Sensitive tools (`workflow_trigger`, `jobs`) now require a `traceId` in the request body
- The server fetches the trace, derives allowed tools via `deriveAllowedTools()`, and rejects calls from personas that do not own the tool
- n8n workflow nodes automatically include `traceId`; if you build custom integrations, pass the trace verbatim from the agent prompt

### Least-Privilege Configuration

- Keep persona `allowedTools` lists tight; remove experimental tools before pushing to production
- Use project playbooks (`data/projects/{projectName}/`) to steer personas instead of widening tool access
- Monitor server logs for 403 responses from `/tools`—they indicate misuse or misconfiguration

---

## Secrets Management Checklist

- [ ] Store secrets in dedicated manager (Vault/AWS Secrets Manager/Doppler)
- [ ] Rotate MCP auth key every 90 days
- [ ] Rotate database user every 90 days
- [ ] Disable DEBUG_AUTH in production
- [ ] Ensure `.env` files never committed

---

## Compliance Quick Audit

- [ ] Explicit CORS origins configured (no wildcards)
- [ ] Host allowlist matches deployment topology
- [ ] Auth key stored in secrets manager
- [ ] Rate limiting enabled and tuned
- [ ] TLS ≥ 1.3 with HSTS
- [ ] Key rotation SOP documented and tested
- [ ] HITL approval tested in staging
- [ ] Incident response runbook up to date

---

## Related Documents

- [Production Runbook](./production-runbook.md)
- [Deployment Guide](./deployment.md)
- [Troubleshooting](./troubleshooting.md)

