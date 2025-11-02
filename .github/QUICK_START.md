# Quick Start Guide

Get up and running in under 5 minutes! ⚡

## Prerequisites

- Node.js 18+ and npm
- Docker and Docker Compose
- Git

## Step 1: Clone & Install

```bash
git clone <your-repo-url>
cd mcp-prompts
npm install
```

## Step 2: Set Up Environment

```bash
# Copy the example environment file
cp .env.example .env

# Edit .env and add your keys
# Required:
#   - OPENAI_API_KEY
#   - DATABASE_URL (or use default)
```

## Step 3: Start Services

```bash
# Start n8n, databases, and cloudflared
npm run dev:up

# Wait a few seconds, then check health
npm run services:check
```

You should see:
```
✅ n8n (localhost)         Container: running       HTTP: ✅ OK
✅ n8n Postgres            Container: running       HTTP: n/a
✅ MCP Postgres            Container: running       HTTP: n/a
```

## Step 4: Run Migrations

```bash
npm run db:migrate
npm run db:operations:migrate
```

## Step 5: Start MCP Server

```bash
# In a new terminal
npm run dev
```

## Step 6: Test It!

```bash
# Open n8n in your browser
open http://localhost:5678

# Check MCP server health
curl http://localhost:3456/health
```

## 🎉 You're Done!

### What's Running?

- **n8n** on http://localhost:5678 - Workflow automation
- **MCP Server** on http://localhost:3456 - Prompt management API
- **PostgreSQL** on ports 5432 (MCP) and 5433 (n8n)
- **Cloudflared** - Secure tunnels to n8n.mjames.dev and mcp-vector.mjames.dev

### Next Steps

1. **Import workflows**: `npm run n8n:push`
2. **Ingest prompts**: `npm run ingest`
3. **Explore the API**: Check http://localhost:3456/metrics

### Common Commands

```bash
# View logs
npm run dev:logs

# Restart services
npm run dev:restart

# Stop everything
npm run dev:down

# Check health
npm run services:check
```

### Troubleshooting

**Can't access http://localhost:5678?**
```bash
npm run dev:restart n8n
```

**Database connection errors?**
```bash
npm run db:migrate
```

**Everything is broken?**
```bash
npm run dev:clean  # WARNING: Removes all data
npm run dev:up
npm run db:migrate
```

### Learn More

- 📖 [Scripts Cheat Sheet](../SCRIPTS_CHEATSHEET.md) - Quick reference
- 📚 [Scripts Guide](../docs/SCRIPTS_GUIDE.md) - Comprehensive documentation
- 🏗️ [Deployment Setup](../docs/DEPLOYMENT_SETUP.md) - Architecture details
- 🔧 [Local Development](../docs/LOCAL-DEVELOPMENT.md) - Development guide

### Get Help

If you encounter issues:
1. Check `npm run services:check`
2. View logs with `npm run dev:logs`
3. See [Troubleshooting Guide](../docs/TROUBLESHOOTING.md)

Happy coding! 🚀

