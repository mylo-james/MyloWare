# Quick Start Guide

Get up and running in 5 minutes!

## Prerequisites

- **Docker Desktop** running
- **Node.js 20+** installed
- **npm** installed

## Setup Steps

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

```bash
# Copy the example environment file
cp .env.example .env

# Edit .env and add your OpenAI API key
nano .env  # or use your preferred editor
```

**Required:** Set your `OPENAI_API_KEY` in `.env`

### 3. Start Everything

```bash
npm run dev:up
```

This single command:

- ✅ Starts PostgreSQL + pgvector in Docker
- ✅ Starts n8n workflow automation in Docker
- ✅ Starts Cloudflare tunnel in Docker
- ✅ Runs database migrations
- ✅ Starts MCP server on your host machine

Wait for the success message showing all services are ready!

### 4. Verify It's Working

```bash
npm run dev:status
```

You should see all green checkmarks ✅

### 5. Test the API

```bash
curl http://localhost:3456/health | jq
```

You should get a JSON response showing `"status": "ok"`

---

## Access Your Services

Once running, you can access:

| Service        | Local URL             | Tunnel URL                    |
| -------------- | --------------------- | ----------------------------- |
| **MCP Server** | http://localhost:3456 | https://mcp-vector.mjames.dev |
| **n8n**        | http://localhost:5678 | https://n8n.mjames.dev        |
| **PostgreSQL** | localhost:5432        | -                             |

---

## Common Commands

```bash
# Start everything
npm run dev:up

# Check status
npm run dev:status

# View logs
npm run dev:logs

# Stop everything
npm run dev:down

# Reset database (⚠️ deletes data)
npm run dev:reset
```

---

## Troubleshooting

### "Port already in use"

Stop any existing Docker containers:

```bash
npm run dev:down
npm run dev:up
```

### "MCP server not responding"

Check the logs:

```bash
npm run dev:logs server
```

Restart the server:

```bash
npm run dev:down
npm run dev:up
```

### "PostgreSQL connection error"

Check database status:

```bash
docker compose ps postgres
npm run dev:logs postgres
```

Reset everything:

```bash
npm run dev:reset
```

### "Container name conflict"

This means there are leftover containers. Run:

```bash
npm run dev:down  # This now cleans up orphaned containers
npm run dev:up
```

---

## Next Steps

### Ingest Some Prompts

```bash
npm run db:ingest
```

This processes all JSON files in `prompts/` and stores them with vector embeddings.

### Search for Prompts

```bash
npm run util:search "machine learning"
```

### Browse Database

```bash
npm run db:studio
```

Opens a visual database browser.

### View Comprehensive Docs

- **Full Guide:** `README.md`
- **Scripts Reference:** `SCRIPTS_GUIDE.md`
- **Architecture Review:** `DEVOPS_ARCHITECTURAL_REVIEW.md`

---

## Development Workflow

1. **Morning:** `npm run dev:up`
2. **Work:** Make changes to code in `src/` - server auto-reloads!
3. **Check:** `npm run dev:status` if something seems off
4. **Debug:** `npm run dev:logs` to view logs
5. **Evening:** `npm run dev:down`

---

## Getting Help

- Run any script with `--help` for usage info
- Check `SCRIPTS_GUIDE.md` for detailed documentation
- View logs: `npm run dev:logs` or `npm run dev:logs server`
- Check status: `npm run dev:status`

---

## Success Indicators

When everything is working, `npm run dev:status` shows:

```
🐳 Docker Containers: All running
🖥️  MCP Server: ✅ Running, ✅ Listening, ✅ Responding
🗄️  PostgreSQL: ✅ Ready
🔄 n8n: ✅ Running
☁️  Cloudflare Tunnel: ✅ Running, ✅ External access working
```

🎉 You're ready to develop!
