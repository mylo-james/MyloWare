# Repository Cleanup Plan

## Current State Analysis

### Problems Identified

1. **Root Directory Bloat**: 30+ temporary markdown files from various development phases
2. **Script Redundancy**: Individual scripts exist that should be consolidated
3. **Documentation Inconsistency**: Multiple overlapping documentation files
4. **Outdated References**: Some docs reference old patterns

---

## 📁 Root-Level Files Audit

### ✅ KEEP (Core Documentation)
- `README.md` - Main project documentation
- `QUICK_START.md` - Quick start guide
- `SCRIPTS_CHEATSHEET.md` - Quick reference (consolidate with SCRIPTS_GUIDE)

### 📦 ARCHIVE (Historical Context)
Move to `archive-docs/` directory:

**Compliance & Fix Documentation:**
- `ADD_DESCRIPTIONS_GUIDE.md`
- `ARGUMENT_WRAPPER_FIX.md`
- `COMPLIANCE_SUMMARY.md`
- `FINAL_COMPLIANCE_REPORT.md`
- `FIXES_SUMMARY.md`
- `MCP_COMPLIANCE_AUDIT.md`
- `MCP_COMPLIANCE_CHECKLIST.md`
- `MCP_COMPLIANCE_FINAL_FIX.md`
- `MCP_COMPLIANCE_INDEX.md`
- `MCP_COMPLIANCE_RESOLUTION.md`
- `MCP_COMPLIANCE_SUMMARY.md`
- `MCP_COMPLIANCE_VERIFICATION.md`
- `MCP_N8N_COMPLIANCE_FINAL.md`
- `MCP_PERFECT_COMPLIANCE.md`
- `N8N_COMPATIBILITY_REALITY.md`
- `N8N_EXAMPLE_RENDERING.md`
- `N8N_FIX_FINAL.md`
- `N8N_SYSTEM_MESSAGE_EXAMPLE.md`
- `TEST_FIX.md`
- `TOOL_DESCRIPTIONS_IMPROVED.md`

**Review Documentation:**
- `revew-gpt-5-codex.md` (typo in filename)
- `review-claude-sonnet-4.5.md`
- `REVIEW-CODEX.md`
- `review.codex.md`
- `REVIEW.md`

**Planning Documentation:**
- `format-plan.md`
- `plan-hitl.md`
- `plan-prompts.md`
- `plan.md`
- `PLANS_INDEX.md`

**DevOps Documentation:**
- `DEVOPS_ARCHITECTURAL_REVIEW.md`
- `DEVOPS_CLEANUP_COMPLETE.md`

**Workflow Documentation:**
- `WORKFLOW_DATAFLOW_ANALYSIS.md`
- `WORKFLOW_FIX_SUMMARY.md`

**Script Documentation:**
- `SCRIPT_CONSOLIDATION_SUMMARY.md`
- `SCRIPT_IMPROVEMENTS_SUMMARY.md`
- `SCRIPTS_GUIDE.md` (move to docs/, keep link from root)

**Other:**
- `VIDEO_QUERY_USAGE.md`

### 🗑️ DELETE (Duplicates/Obsolete)
- `mylo-mcp-agent.workflow.json` (belongs in workflows/)

---

## 🔧 Scripts Directory Cleanup

### Current State
37 files in scripts/ - many should be consolidated

### Target State
According to `SCRIPTS_GUIDE.md`, should have just:

**Top-Level Scripts (10):**
- ✅ `dev-up.sh`
- ✅ `dev-down.sh`  
- ✅ `dev-reset.sh`
- ✅ `dev-status.sh`
- ✅ `dev-logs.sh`
- ✅ `init-db.sql`
- ✅ `preDev.ts`
- ✅ `db-utils.ts` (needs creation - consolidate DB operations)
- ✅ `workflow-utils.ts` (needs creation - consolidate workflow operations)
- ✅ `utilities.ts` (needs creation - consolidate general utilities)

**Implementation Scripts (keep in scripts/):**
- `runMigrations.ts`
- `runOperationsMigrations.ts`
- `ingestPrompts.ts`
- `wipeOperationsDb.ts`
- `n8nSync.ts`
- `extractSchemas.ts`
- `injectSchemas.ts`
- `formatWorkflows.ts`
- `generateWorkflowTemplates.ts`
- `validateToolSpecs.ts`
- `validateWorkflowState.ts`
- `archiveAismrVideos.ts`
- `backfillRunsToEpisodic.ts`
- `migrateMemoryTypes.ts`
- `summarizeEpisodicMemory.ts`
- `checkServices.ts`
- `manageComposeStack.ts`
- `manageDevStack.ts`
- `runCloudflared.ts`
- `createTunnelCredentials.ts`
- `tools/runVectorSearch.ts`
- `tools/runPromptKeywordSearch.ts`
- `tools/showPromptChunks.ts`

**Delete/Review:**
- `runMigrations.js` - compiled output, shouldn't be in source
- `runMigrations.js.map` - compiled output
- `test-mcp-auth.ts` - check if still needed

---

## 📝 Package.json Script Cleanup

### Current Issues
- Duplicate/inconsistent naming
- Mix of old and new patterns
- Some scripts reference non-existent files

### Proposed Cleanup

```json
{
  "scripts": {
    // Build & Run
    "build": "tsc --project tsconfig.json",
    "dev": "tsx scripts/preDev.ts && tsx watch src/server.ts",
    "start": "node dist/server.js",
    
    // Development Environment
    "dev:up": "tsx scripts/manageDevStack.ts up -d",
    "dev:down": "tsx scripts/manageDevStack.ts down",
    "dev:restart": "tsx scripts/manageDevStack.ts restart",
    "dev:logs": "tsx scripts/manageDevStack.ts logs -f",
    "dev:status": "tsx scripts/manageDevStack.ts status",
    "dev:clean": "tsx scripts/manageDevStack.ts clean",
    
    // Database Operations
    "db:migrate": "tsx scripts/runMigrations.ts",
    "db:migrate-ops": "tsx scripts/runOperationsMigrations.ts",
    "db:wipe-ops": "tsx scripts/wipeOperationsDb.ts",
    "db:studio": "drizzle-kit studio",
    "db:ingest": "tsx scripts/ingestPrompts.ts",
    
    // Workflow & n8n
    "workflow:sync-push": "npm run schemas:inject && tsx scripts/n8nSync.ts --push",
    "workflow:sync-pull": "tsx scripts/n8nSync.ts --pull && npm run schemas:extract",
    "workflow:validate": "tsx scripts/validateToolSpecs.ts && tsx scripts/validateWorkflowState.ts",
    
    // Schemas
    "schemas:extract": "tsx scripts/extractSchemas.ts",
    "schemas:inject": "tsx scripts/injectSchemas.ts",
    
    // Utilities
    "util:archive": "tsx scripts/archiveAismrVideos.ts",
    "util:backfill": "tsx scripts/backfillRunsToEpisodic.ts",
    "util:search": "tsx scripts/tools/runVectorSearch.ts",
    "util:tunnel": "tsx scripts/runCloudflared.ts",
    "services:check": "tsx scripts/checkServices.ts",
    
    // Code Quality
    "lint": "eslint .",
    "format": "prettier --write .",
    "test": "vitest --run",
    "test:watch": "vitest",
    "type-check": "tsc --noEmit"
  }
}
```

**Remove These (deprecated/duplicate):**
- `db:operations:migrate` → use `db:migrate-ops`
- `db:operations:wipe` → use `db:wipe-ops`
- `ingest` → use `db:ingest`
- `ingest:prompts` → use `db:ingest`
- `aismr:archive-videos` → use `util:archive`
- `tunnel` → use `util:tunnel`
- `tunnel:credentials` → rarely used, can call directly
- `episodic:backfill` → use `util:backfill`
- `stack:dev` → use `dev:up`
- `stack:dev:down` → use `dev:down`
- `stack:prod` → document in deployment guide
- `stack:prod:down` → document in deployment guide
- `n8n:push` → use `workflow:sync-push`
- `n8n:pull` → use `workflow:sync-pull`
- `validate:tool-specs` → use `workflow:validate`

---

## 📚 Documentation Structure

### Target Structure

```
/
├── README.md                          # Main entry point
├── QUICK_START.md                     # Getting started
├── SCRIPTS_CHEATSHEET.md             # Quick command reference
│
├── docs/                              # Detailed documentation
│   ├── README.md                      # Index of all docs
│   ├── LOCAL-DEVELOPMENT.md          # Development guide
│   ├── DEPLOYMENT.md                 # Deployment guide  
│   ├── SCRIPTS_GUIDE.md              # Complete scripts reference
│   ├── ADDING_NEW_PROJECTS.md
│   ├── MEMORY_ARCHITECTURE.md
│   └── ... (other technical docs)
│
└── archive-docs/                      # Historical documentation
    ├── reviews/                       # Code reviews
    ├── compliance/                    # Compliance audits
    ├── fixes/                         # Fix documentation
    └── plans/                         # Planning documents
```

---

## 🎯 Action Plan

### Phase 1: Archive Documentation ✓
1. Create `archive-docs/` structure
2. Move all temporary docs to appropriate subdirectories
3. Update any references in main docs

### Phase 2: Clean Scripts ✓
1. Verify which scripts are actually used
2. Check if consolidated scripts (db-utils, workflow-utils, utilities) exist
3. Remove compiled JS files from source
4. Test that all npm scripts still work

### Phase 3: Update Package.json ✓
1. Standardize script naming
2. Remove deprecated scripts
3. Add missing scripts (test:watch, type-check)
4. Test all scripts work

### Phase 4: Update Documentation ✓
1. Update README.md references
2. Consolidate SCRIPTS_GUIDE with SCRIPTS_CHEATSHEET
3. Update docs/README.md index
4. Verify all links work

### Phase 5: Update .gitignore ✓
1. Add patterns to prevent future doc bloat
2. Ignore common temporary files

### Phase 6: Final Verification ✓
1. Run full test suite
2. Verify dev environment starts
3. Check documentation is accessible
4. Commit changes following workflow

---

## Success Metrics

- ✅ Root directory has < 10 markdown files
- ✅ Scripts directory is organized and documented
- ✅ All npm scripts follow consistent naming
- ✅ Documentation is consolidated and accessible
- ✅ No broken links in documentation
- ✅ All tests pass
- ✅ Dev environment starts successfully

---

## Timeline

**Estimated Time:** 2-3 hours

1. Archive docs: 30 min
2. Script cleanup: 45 min
3. Package.json: 30 min
4. Documentation: 45 min
5. Testing & verification: 30 min

