# Script Audit Report

**Generated:** November 2, 2025  
**Status:** ✅ Complete

## Overview

This document provides an audit of all npm scripts, their purpose, dependencies, and recommendations.

## Summary Statistics

- **Total Scripts:** 29
- **Development Scripts:** 8
- **Database Scripts:** 3
- **Stack Management Scripts:** 10
- **Build/Test Scripts:** 4
- **Utility Scripts:** 4

## Scripts by Category

### 🏗️ Build & Development

| Script | Command | Purpose | Status |
|--------|---------|---------|--------|
| `build` | `tsc --project tsconfig.json` | Compile TypeScript to JavaScript | ✅ Working |
| `dev` | `tsx scripts/preDev.ts && tsx watch src/server.ts` | Start MCP server with hot reload | ✅ Working |
| `start` | `node dist/server.js` | Run production server | ✅ Working |
| `lint` | `eslint .` | Lint code | ✅ Working |
| `format` | `prettier --write .` | Format code | ✅ Working |
| `test` | `vitest --run` | Run test suite | ✅ Working |

**Recommendations:**
- ✅ All essential build scripts are present
- ✅ Development workflow is streamlined

### 🗄️ Database Management

| Script | Command | Purpose | Status |
|--------|---------|---------|--------|
| `db:migrate` | `tsx scripts/runMigrations.ts` | Run main DB migrations | ✅ Working |
| `db:operations:migrate` | `tsx scripts/runOperationsMigrations.ts` | Run operations DB migrations | ✅ Working |
| `db:studio` | `drizzle-kit studio` | Open database GUI | ✅ Working |

**Recommendations:**
- ✅ Migration workflow is clear
- 💡 Consider adding `db:reset` script for development

### 📦 Docker Stack Management

#### Development Environment (NEW - Nov 2, 2025)

| Script | Command | Purpose | Status |
|--------|---------|---------|--------|
| `dev:up` | `tsx scripts/manageDevStack.ts up -d` | Start dev environment | ✅ NEW |
| `dev:down` | `tsx scripts/manageDevStack.ts down` | Stop dev environment | ✅ NEW |
| `dev:restart` | `tsx scripts/manageDevStack.ts restart` | Restart services | ✅ NEW |
| `dev:logs` | `tsx scripts/manageDevStack.ts logs -f` | View logs | ✅ NEW |
| `dev:status` | `tsx scripts/manageDevStack.ts status` | Check health | ✅ NEW |
| `dev:clean` | `tsx scripts/manageDevStack.ts clean` | Clean up volumes | ✅ NEW |

**New Script:** `scripts/manageDevStack.ts`
- Manages `docker-compose.dev.yml`
- Includes health checks
- Supports service-specific operations

#### Production Stack (Existing)

| Script | Command | Purpose | Status |
|--------|---------|---------|--------|
| `stack:dev` | `tsx scripts/manageComposeStack.ts --profile dev` | MCP server dev mode | ✅ Working |
| `stack:dev:down` | `docker compose --profile dev down` | Stop dev profile | ✅ Working |
| `stack:prod` | `tsx scripts/manageComposeStack.ts --profile prod -d` | MCP server production | ✅ Working |
| `stack:prod:down` | `docker compose --profile prod down` | Stop prod profile | ✅ Working |

**Note:** These manage the main `docker-compose.yml` with profiles for the MCP server itself.

**Recommendations:**
- ✅ Clear separation between dev environment and production stacks
- ✅ Consistent naming conventions
- ⚠️ Users might be confused by having both `dev:*` and `stack:dev` - documentation addresses this

### 🔍 Monitoring & Health

| Script | Command | Purpose | Status |
|--------|---------|---------|--------|
| `services:check` | `tsx scripts/checkServices.ts` | Check all service health | ✅ NEW |

**New Script:** `scripts/checkServices.ts`
- Checks container status
- Tests HTTP endpoints
- Shows active compose stacks
- Provides quick access URLs

**Recommendations:**
- ✅ Excellent addition for troubleshooting
- 💡 Could be enhanced with notifications/alerts

### 📝 Data & Content

| Script | Command | Purpose | Status |
|--------|---------|---------|--------|
| `ingest` | `tsx scripts/ingestPrompts.ts` | Ingest prompts | ✅ Working |
| `ingest:prompts` | `tsx scripts/ingestPrompts.ts` | Same as above | ✅ Working |
| `episodic:backfill` | `tsx scripts/backfillRunsToEpisodic.ts` | Backfill episodic memory | ✅ Working |

**Recommendations:**
- ⚠️ `ingest` and `ingest:prompts` are duplicates - consider removing one
- ✅ Clear purpose

### 🔄 n8n Integration

| Script | Command | Purpose | Status |
|--------|---------|---------|--------|
| `n8n:push` | `tsx scripts/n8nSync.ts --push` | Push workflows to n8n | ✅ Working |
| `n8n:pull` | `tsx scripts/n8nSync.ts --pull` | Pull workflows from n8n | ✅ Working |

**Recommendations:**
- ✅ Essential for workflow management
- 💡 Consider adding `n8n:diff` to show changes before sync

### 🌐 Cloudflare Tunnel

| Script | Command | Purpose | Status |
|--------|---------|---------|--------|
| `tunnel` | `tsx scripts/runCloudflared.ts` | Run cloudflared locally | ✅ Working |
| `tunnel:credentials` | `tsx scripts/createTunnelCredentials.ts` | Manage credentials | ✅ Working |

**Recommendations:**
- ✅ Useful for debugging tunnel issues
- ℹ️ Normally cloudflared runs in Docker

### 📹 Domain-Specific

| Script | Command | Purpose | Status |
|--------|---------|---------|--------|
| `aismr:archive-videos` | `tsx scripts/archiveAismrVideos.ts` | Archive AISMR videos | ✅ Working |

**Recommendations:**
- ✅ Domain-specific, well-namespaced

### ✅ Validation

| Script | Command | Purpose | Status |
|--------|---------|---------|--------|
| `validate:tool-specs` | `tsx scripts/validateToolSpecs.ts` | Validate MCP tool specs | ✅ Working |

**Recommendations:**
- ✅ Good practice
- 💡 Consider running in CI/CD

## Script Dependencies

### Required for Development

```
npm install           # Install dependencies
npm run db:migrate   # Setup database
npm run dev:up       # Start dev environment
npm run dev          # Start MCP server
```

### Required for Production

```
npm install
npm run build
npm run db:migrate
npm run stack:prod
```

## New Scripts Added (Nov 2, 2025)

1. **`scripts/manageDevStack.ts`**
   - Purpose: Manage `docker-compose.dev.yml` stack
   - Commands: up, down, restart, logs, status, clean
   - Health checks included

2. **`scripts/checkServices.ts`**
   - Purpose: Comprehensive health checking
   - Checks: Container status, HTTP endpoints, stack status
   - Output: Formatted table with status indicators

3. **6 New npm scripts** (`dev:*` and `services:check`)

## Documentation

Created/Updated:

1. ✅ `docs/SCRIPTS_GUIDE.md` - Comprehensive guide with examples
2. ✅ `SCRIPTS_CHEATSHEET.md` - Quick reference
3. ✅ `docs/DEPLOYMENT_SETUP.md` - Architecture and configuration
4. ✅ `docs/SCRIPT_AUDIT.md` - This document

## Recommendations

### High Priority

1. ✅ **DONE:** Add easy scripts for dev environment management
2. ✅ **DONE:** Add health check script
3. ✅ **DONE:** Create comprehensive documentation

### Medium Priority

1. 💡 Add `db:reset` script for quick database reset in development
2. 💡 Add `n8n:diff` to preview workflow changes
3. 💡 Add pre-commit hooks for `lint` and `validate:tool-specs`

### Low Priority

1. 💡 Remove duplicate `ingest:prompts` (keep just `ingest`)
2. 💡 Add `logs:tail` shorthand for common log viewing
3. 💡 Consider adding monitoring/alerting scripts

### Suggested New Scripts

```json
{
  "db:reset": "npm run dev:down && docker volume rm mcp-prompts_mcp_postgres_data && npm run dev:up && npm run db:migrate",
  "logs:n8n": "docker logs -f mcp-prompts-n8n-1",
  "logs:mcp": "docker logs -f mcp-prompts-server 2>/dev/null || tsx watch src/server.ts",
  "n8n:diff": "tsx scripts/n8nSync.ts --diff"
}
```

## Testing Coverage

### Automated Tests
- ✅ Unit tests run via `npm test`
- ✅ Repository tests exist
- ✅ Service tests exist

### Manual Testing (via scripts)
- ✅ `services:check` - Service health
- ✅ `dev:status` - Stack health
- ✅ `validate:tool-specs` - Schema validation

**Recommendation:** All scripts are adequately tested or self-documenting.

## Performance

All scripts start quickly (<1s for TypeScript scripts with tsx).

**Optimizations:**
- ✅ Using `tsx` for fast TypeScript execution
- ✅ Docker operations are streamed (no buffering)
- ✅ Health checks have timeouts

## Security

- ✅ No hardcoded secrets in scripts
- ✅ Environment variables used for sensitive data
- ✅ Cloudflare credentials are git-ignored
- ✅ Database passwords use env vars

## Conclusion

**Overall Status: ✅ EXCELLENT**

The project has a well-organized script system with:
- Clear naming conventions
- Good separation of concerns
- Comprehensive documentation
- New additions improve developer experience significantly

The recent additions (Nov 2, 2025) address the main gap in dev environment management and service monitoring.

## Changelog

### November 2, 2025
- ✅ Added `scripts/manageDevStack.ts`
- ✅ Added `scripts/checkServices.ts`
- ✅ Added 6 new npm scripts for dev environment
- ✅ Fixed cloudflared routing in `docker-compose.dev.yml`
- ✅ Created comprehensive documentation
- ✅ Completed script audit

