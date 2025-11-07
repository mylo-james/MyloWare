# Development Guide

This guide explains how to run the MCP server with hot reload for rapid development.

## 🔥 Hot Reload Options

You have **three ways** to run the development server with hot reload:

### Option 1: Local Development (Fastest) ⚡

Run the server directly on your machine with instant hot reload:

```bash
# Start development server with hot reload
npm run dev

# Or with cleaner output (no screen clearing)
npm run dev:local
```

**Requirements:**
- Node.js 20+
- PostgreSQL running on `localhost:5432`
- Environment variables set in `.env`

**Pros:**
- ⚡ Instant reload (no Docker overhead)
- 🐛 Easy debugging
- 💨 Fastest iteration

**Cons:**
- Requires local PostgreSQL
- Need to manage dependencies manually

---

### Option 2: Docker Dev Mode (Recommended) 🐳

Run the server in Docker with hot reload and isolated environment:

```bash
# Start everything with hot reload
npm run dev:docker

# Watch logs
npm run dev:docker:logs

# Stop dev environment
npm run dev:stop
```

**What gets started:**
- PostgreSQL with pgvector
- MCP Server (with hot reload)
- n8n workflow engine

**Pros:**
- 🏗️ Complete environment isolation
- 📦 No local dependencies needed
- 🔄 Automatic reload on file changes
- ✅ Production-like setup

**Cons:**
- Slightly slower reload (~2-3 seconds)
- Docker overhead

---

### Option 3: Production Mode 🚀

Run compiled TypeScript (no hot reload):

```bash
# Build TypeScript
npm run build

# Start production server
npm start

# Or with production env
npm run start:prod
```

**When to use:**
- Final testing before deployment
- Performance benchmarking
- Production deployment

---

## 📁 What Triggers Hot Reload?

The development server automatically reloads when you change:

### Source Code
- `src/**/*.ts` - All TypeScript source files
- `scripts/**/*.ts` - Database scripts and utilities

### Configuration
- `tsconfig.json` - TypeScript configuration
- `drizzle.config.ts` - Database configuration
- `package.json` - Dependencies (requires restart)

### Data
- `data/**/*.json` - Personas, projects, workflows
- `workflows/**/*.json` - n8n workflow definitions

### What **doesn't** trigger reload:
- `node_modules/` - Excluded
- `dist/` - Build output (excluded)
- `.env` - Requires manual restart

---

## 🛠️ Development Workflow

### Typical Development Flow

```bash
# 1. Start dev server
npm run dev:docker

# 2. Make code changes in src/
#    → Server automatically reloads

# 3. Check logs
npm run dev:docker:logs

# 4. Test your changes
npm run test:mcp

# 5. Stop when done
npm run dev:stop
```

### TypeScript Type Checking

```bash
# Run type checker (no build)
npm run type-check

# Build and watch for changes
npm run build:watch
```

### Database Development

```bash
# Reset database
npm run db:reset

# Seed data
npm run db:seed

# Run migrations
npm run migrate:all
```

### Fast Unit Tests (Reusable Test DB)

Long-running Testcontainers startup is now optional. To get sub-second Vitest boots:

1. Provision a dedicated test database once:
   ```bash
   export TEST_DB_SUPER_URL=postgresql://postgres:postgres@127.0.0.1:6543/postgres
   export TEST_DB_URL=postgresql://mcp_test:test@127.0.0.1:6543/mcp_v2_test
   npm run db:setup:test
   ```
   The script creates the `mcp_test` role, the `mcp_v2_test` database, and ensures the `vector` extension is installed.
2. Export `TEST_DB_URL` (add it to your shell profile or `.env.test.local`).
3. Run the focused Vitest target without containers:
   ```bash
   npm run test:unit:local
   ```

If you still need a disposable container (e.g. CI), run `npm run test:unit:container` or set `TEST_DB_USE_CONTAINER=1` before invoking any `vitest` command. The harness auto-detects Colima/Docker Desktop sockets, launches PostgreSQL on a random free host port, and propagates that port to Drizzle/`POSTGRES_PORT`. Set `TEST_DB_PORT` only if you truly need a fixed port; otherwise let the harness pick one to avoid clashing with a running dev database.

> ⚠️ The dedicated test DB truncates tables during each run. Do not point it at your primary dev database.

---

## 🐛 Debugging

### VS Code Debugging (Local Mode)

Create `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug MCP Server",
      "type": "node",
      "request": "launch",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["run", "dev:local"],
      "skipFiles": ["<node_internals>/**"],
      "env": {
        "NODE_ENV": "development"
      }
    }
  ]
}
```

### Docker Debugging

```bash
# Attach to running container
docker exec -it mcp-server-dev sh

# View logs with timestamps
docker compose logs -f --timestamps mcp-server-dev

# Restart just the dev server
docker compose restart mcp-server-dev
```

---

## 🔧 Troubleshooting

### Hot Reload Not Working?

**Docker Mode:**
```bash
# Rebuild with fresh volumes
npm run dev:stop
docker compose --profile dev build --no-cache
npm run dev:docker
```

**Local Mode:**
```bash
# Clear node_modules and reinstall
rm -rf node_modules dist
npm install
npm run dev
```

### Port Already in Use?

```bash
# Find and kill process on port 3456
lsof -ti:3456 | xargs kill -9

# Or change port in .env
echo "SERVER_PORT=3457" >> .env
```

### Database Connection Failed?

```bash
# Check if postgres is running (Docker)
docker compose ps postgres

# Check connection (Local)
psql postgresql://mylo:development@localhost:5432/memories

# Reset database
npm run db:reset
```

### File Changes Not Detected?

Check that files are not ignored:
```bash
# View what tsx is watching
npm run dev -- --verbose
```

---

## 📊 Performance Tips

### Faster Hot Reload

1. **Use Local Mode** for fastest iteration
2. **Exclude large directories** from watch:
   - `node_modules/` (already excluded)
   - `dist/` (already excluded)
   - `.git/` (already excluded)

### Optimize Docker Dev

```bash
# Use BuildKit for faster builds
export DOCKER_BUILDKIT=1

# Prune unused images
docker system prune -f
```

---

## 🎯 Quick Commands Reference

| Task | Command |
|------|---------|
| **Local dev** | `npm run dev` |
| **Docker dev** | `npm run dev:docker` |
| **Watch logs** | `npm run dev:docker:logs` |
| **Stop dev** | `npm run dev:stop` |
| **Type check** | `npm run type-check` |
| **Build** | `npm run build` |
| **Test MCP** | `npm run test:mcp` |
| **Reset DB** | `npm run db:reset` |

---

## 🚀 Next Steps

- Read [ARCHITECTURE.md](docs/ARCHITECTURE.md) to understand the codebase
- Check [MCP_TOOLS.md](docs/MCP_TOOLS.md) for tool development
- See [DEPLOYMENT.md](docs/DEPLOYMENT.md) for production setup

Happy coding! 🎉
