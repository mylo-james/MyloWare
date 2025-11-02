# Comprehensive Code Review: MCP Prompts AISMR System

**Date:** November 1, 2025  
**Reviewer:** AI Assistant  
**Project:** MCP Prompts Vector Database + AISMR Video Generation  
**Goal:** Assess architecture and provide "north star" vision for one-shot video generation

---

## Executive Summary

You've built a **sophisticated RAG-powered orchestration system** that's 80% of the way to production excellence. The MCP server architecture is solid, the vector search is state-of-the-art (hybrid search ✅, memory components ✅, graph expansion ✅, episodic memory ✅), and the prompt system is well-designed.

**What You Got Right:** Your 4-stage pipeline design (Generate Ideas → Write Script → Make Videos → Post Video) is **architecturally correct**. The separation enables quality gates, HITL checkpoints, independent failure handling, and testability. Using n8n for its UI and integrations (veo-3-fast, Shotstack, TikTok) is the right choice.

**The Core Problem:** Workflow orchestration logic is **hard-coded in n8n workflows** (1500+ line system prompts) instead of stored in your RAG system. You've built an advanced RAG with procedural memory, memory routing, and graph expansion—but you're not using it to store and retrieve workflow definitions.

**The North Star:** Four autonomous n8n workflows with HITL gates, where each workflow:

1. **Loads its orchestration logic from RAG** (procedural memory)
2. **Uses advanced RAG features** (memory routing, graph expansion, adaptive search)
3. **Executes intelligently** via MCP agents
4. **Validates at quality gates** with HITL approval
5. **Generalizes easily** to new projects (just add new prompts to RAG)

**Current Grade:** A- (RAG Architecture) + B (Orchestration) = **B+** (Overall)  
**North Star Grade:** A+ (RAG-driven autonomous pipeline with HITL)

---

## Part 1: Architecture Assessment

### 🎯 What You Got Right

#### 1. **MCP Server Architecture** ⭐⭐⭐⭐⭐

Your MCP server is production-grade:

- Clean separation: HTTP transport, tool registration, repository pattern
- Proper error handling and validation
- Fastify + CORS + rate limiting
- Cloudflare tunnel integration
- Feature flags for gradual rollout

```1:32:src/server/createMcpServer.ts
import type { McpServer as McpServerType } from '@modelcontextprotocol/sdk/server/mcp.js' with { 'resolution-mode': 'import' };
import { registerPromptGetTool } from './tools/promptGetTool';
import { registerPromptListTool } from './tools/promptListTool';
import { registerPromptSearchTool } from './tools/promptSearchTool';
import { registerAdaptiveSearchTool } from './tools/adaptiveSearchTool';
import { registerConversationMemoryTool } from './tools/conversationMemoryTool';
import { registerConversationStoreTool } from './tools/conversationStoreTool';
import { registerConversationLatestTool } from './tools/conversationLatestTool';
import { registerMemoryTools } from './tools/memoryAddTool';
import { registerResources } from './resources';

export async function createMcpServer(): Promise<McpServerType> {
  const { McpServer } = (await import(
    '@modelcontextprotocol/sdk/server/mcp.js'
  )) as unknown as typeof import('@modelcontextprotocol/sdk/dist/cjs/server/mcp.js');
  const server = new McpServer({
    name: 'mcp-prompts',
    version: '0.1.0',
  }) as unknown as McpServerType;

  registerPromptGetTool(server);
  registerPromptListTool(server);
  registerPromptSearchTool(server);
  registerAdaptiveSearchTool(server);
  registerConversationMemoryTool(server);
  registerConversationStoreTool(server);
  registerConversationLatestTool(server);
  registerMemoryTools(server);
  registerResources(server);

  return server;
}
```

**Strength:** This is textbook clean architecture. Tools are independently registered, server creation is type-safe, and the structure scales beautifully.

#### 2. **RAG Implementation** ⭐⭐⭐⭐⭐

You've implemented Phase 1-3 of modern RAG (2024-2025 standards):

✅ **Hybrid Search** (vector + BM25)
✅ **Memory Components** (persona, project, semantic, episodic, procedural)
✅ **Graph Expansion** (semantic links between memories)
✅ **Temporal Weighting** (recency boosting)
✅ **Episodic Memory** (conversation storage)
✅ **Adaptive Retrieval** (iterative query refinement)

Your repository pattern is exemplary:

```280:363:src/db/repository.ts
  async search(params: SearchParameters): Promise<SearchResult[]> {
    const { embedding, persona, project, limit, minSimilarity, memoryTypes } = params;

    if (embedding.length === 0) {
      return [];
    }

    const normalizedLimit = Math.max(1, Math.min(limit, 50));
    const similarityThreshold = Math.min(Math.max(minSimilarity, 0), 1);

    const embeddingLiteral = sql.raw(`'${vectorToSql(embedding)}'::vector`);
    const baseSimilarityExpression = sql`1 - (${schema.promptEmbeddings.embedding} <=> ${embeddingLiteral})`;
    const ageDaysExpression = sql`GREATEST(EXTRACT(EPOCH FROM (NOW() - COALESCE(${schema.promptEmbeddings.updatedAt}, NOW()))) / 86400.0, 0)`;
    const temporalSettings = this.resolveTemporalSettings(params);
    const similarityExpression =
      temporalSettings === null
        ? baseSimilarityExpression
        : this.applyTemporalDecayToSimilarity(
            baseSimilarityExpression,
            ageDaysExpression,
            temporalSettings,
          );
    const thresholdExpression = temporalSettings === null ? baseSimilarityExpression : similarityExpression;

    const conditions: SQL[] = [
      sql`${thresholdExpression} >= ${similarityThreshold}`,
      sql`COALESCE(${schema.promptEmbeddings.metadata} ->> 'status', 'active') <> 'inactive'`,
    ];

    if (persona) {
      const personaValue = persona.toLowerCase();
      conditions.push(
        sql`${schema.promptEmbeddings.metadata} @> ${JSON.stringify({
          persona: [personaValue],
        })}::jsonb`,
      );
    }

    if (project) {
      const projectValue = project.toLowerCase();
      conditions.push(
        sql`${schema.promptEmbeddings.metadata} @> ${JSON.stringify({
          project: [projectValue],
        })}::jsonb`,
      );
    }

    if (Array.isArray(memoryTypes) && memoryTypes.length > 0) {
      conditions.push(this.buildMemoryTypeCondition(memoryTypes));
    }

    const whereClause = sql.join(conditions, sql` AND `);

    const query = sql<SearchRow>`
      SELECT
        ${schema.promptEmbeddings.chunkId} AS "chunkId",
        ${schema.promptEmbeddings.filePath} AS "promptKey",
        ${schema.promptEmbeddings.chunkText} AS "chunkText",
        ${schema.promptEmbeddings.rawMarkdown} AS "rawSource",
        ${schema.promptEmbeddings.metadata} AS "metadata",
        ${schema.promptEmbeddings.memoryType} AS "memoryType",
        ${ageDaysExpression} AS "ageDays",
        ${similarityExpression} AS "similarity"
      FROM ${schema.promptEmbeddings}
      WHERE ${whereClause}
      ORDER BY "similarity" DESC
      LIMIT ${normalizedLimit}
    `;

    const { rows } = await this.db.execute(query);

    return rows.map((row) => ({
      chunkId: typeof row.chunkId === 'string' ? row.chunkId : String(row.chunkId),
      promptKey: typeof row.promptKey === 'string' ? row.promptKey : String(row.promptKey),
      chunkText: typeof row.chunkText === 'string' ? row.chunkText : String(row.chunkText ?? ''),
      rawSource: typeof row.rawSource === 'string' ? row.rawSource : String(row.rawSource ?? ''),
      metadata: (row.metadata ?? {}) as PromptMetadata,
      similarity: Number(row.similarity),
      ageDays:
        row.ageDays == null || Number.isNaN(Number(row.ageDays)) ? null : Number(row.ageDays),
      temporalDecayApplied: temporalSettings !== null,
      memoryType: (row.memoryType ?? 'semantic') as MemoryType,
    }));
  }
```

**Strength:** This search implementation is research-grade. You have temporal decay, metadata filtering, memory type routing, and proper SQL construction. This is better than most production RAG systems.

#### 3. **Prompt Schema Design** ⭐⭐⭐⭐

Your JSON prompt schema is well-thought-out:

```1:100:prompts/project-aismr.json
{
  "title": "AISMR Project",
  "activation_notice": "This file contains your complete configuration.",
  "critical_notice": "Read the full JSON object below for your operating parameters.",
  "agent": {
    "name": "AISMR",
    "id": "aismr",
    "title": "Surreal ASMR Micro-Film Project",
    "icon": "🌀",
    "whentouse": "Any workflow or prompt that must align with AISMR's tactile-surreal brand DNA",
    "customization": "Protect the 8-second, single-shot format, the 3.0s whisper beat, and the no-music rule above all else."
  },
  "persona": {
    "role": "Brand steward for surreal ASMR micro-films that feel handmade and impossibly tactile",
    "style": "Calm, cinematic, sensory-first, precise, transcendently weird yet grounded",
    "identity": "Project orientation detailing AISMR's signature vibe, guardrails, and evaluation criteria",
    "focus": "Sensory storytelling, grounded surrealism, loopable replay value, sacred timing, hand discipline",
    "core_principles": [
      "Sensory First - Let texture, micro-sound, and light drive every beat.",
      "Surreal yet Grounded - Bend physics while keeping camera, lighting, and materials believable.",
      "Replay Hooks - Build irresistible loops that invite instant rewatch.",
      "Impossible Made Filmable - Showcase anti-gravity flows, molten-yet-behaved matter, and other plausible impossibilities.",
      "Environment Magic - Make setting and subject inseparable; the where amplifies the what.",
      "Format Discipline - Deliver 8-second, single-shot, vertical (9:16) pieces with continuous motion.",
      "Sacred Whisper - Place one intimate whisper at exactly 3.0 seconds; never early, never late.",
      "No Music Ever - Maintain vacuum-bed ambience, hyper-detailed foley, and whisper only; music lives in post.",
      "Two Hands Max - Allow at most two hands from the same person when hands appear; avoid disembodied clutter.",
      "Quiet Confidence - Stay calm, intimate, and irony-free; surprise with care.",
      "Higher-Power Aesthetics - Aim for divine, infernal, or enigmatic tones that feel transcendent, not cartoony.",
      "Uniqueness Protection - Guard the archive against duplicate descriptors and recycled ideas.",
      "Status Transparency - Report struggles like timing drift, extra hands, or music contamination immediately."
    ]
  },
  "orientation": {
    "what_we_are": [
      "A catalog of surreal ASMR micro-films combining dream logic with tactile realism.",
      "Short, replayable, oddly soothing pieces that feel handmade and a little impossible."
    ],
    "north_stars": [
      "Sensory first: texture, micro-sound, and light do the storytelling.",
      "Surreal but grounded: physics can bend while camera and materials stay real.",
      "Rewatch loops: build a tiny hook that invites again."
    ],
    "signature_surrealism": [
      "We celebrate the impossible made plausible: anti-gravity flows, molten yet behaved matter, living sea-foam, glass that breathes, velvet that drinks light, metal that stretches like taffy.",
      "Surreal means reality is questioned but never cartooned; camera, lighting, and textures remain convincing while the phenomenon defies nature.",
      "Example spirit: a lava apple, a gravity-confused rain, a stretchy marble leaf shot as if a VFX crew captured it in-lens.",
      "Environment is part of the magic: a stone puppy on a mountaintop at golden hour, a liquid mercury bird floating in void space, an ember fox in a crystalline cave."
    ],
    "brand_dna": [
      "Format: 8-second, single-shot, vertical (9:16).",
      "Feel: calm, intimate, cinematic with dust, haze, and particle shimmer.",
      "Audio identity: vacuum-bed ambience, hyper-detailed foley (especially nail tapping on hard surfaces), one intimate whisper spoken directly into mic at exactly 3.0 seconds, and absolutely no music, score, or soundtrack during generation.",
      "Timing discipline: the 3-second whisper is foundational; mistiming ruins the shot.",
      "Hand discipline: maximum two hands from the same person unless the video is explicitly about people; no floating hand salads."
    ],
    "evaluation_criteria": [
      "Strikingness: does frame 0-2 seconds stop the thumb?",
      "Tactile richness: can you feel the subject?",
      "Environment resonance: does the setting elevate the object?",
      "Filmability: could a VFX team plausibly shoot this?",
      "Emotional aftertaste: serene, awe, haunt, playful, tense, chaotic, trickster, enigmatic on purpose.",
      "Uniqueness: no recycled descriptors; the archive matters."
    ],
    "voice_and_vibe": [
      "Quiet confidence with no snark or irony-poisoning.",
      "Intimate scale with macro textures, slow motion, and honest inertia.",
      "Tasteful weird: surprise with care, not edge for edge's sake.",
      "POV-centered: if hands appear, they belong to one person and stay within the two-hand limit.",
      "Environment matters: stunning, evocative settings that amplify the subject.",
      "POV interaction: safely touch, pet, or tap the impossible without consequence.",
      "Higher-power aesthetics: aim for divine, infernal, or enigmatic tones that feel elevated, never cartoony.",
      "Diverse voices and bodies: a range of people whisper intimately into the mic.",
      "Motion discipline: enter in motion and exit in motion without fade-in or fade-out during generation.",
      "Flow-through transitions: maintain motion continuity across transitions."
    ],
    "wins": [
      "A recognizable sensorial signature across zodiac signs.",
      "Ideas that travel to Reels and Shorts without losing personality.",
      "A growing archive with zero duplicates."
    ],
    "current_struggles": [
      "Balancing novelty versus model stability.",
      "Guarding uniqueness at scale when descriptors converge over time.",
      "Latency and provider drift requiring up-to-date prompts and tooling.",
      "Maintaining safety and brand fit within short-form culture.",
      "Ensuring motion timing stays continuous from first to last millisecond without fade artifacts.",
      "Keeping transition flow via cross-dissolve rather than dead stops.",
      "Achieving true mic-quality whisper versus distant ambiance.",
      "Calibrating aesthetics so divine or transcendent tones avoid cartoony outcomes.",
      "Enforcing timing precision: whispers drifting from 3.0 seconds destroy flow.",
      "Preventing hand horror: more than two hands looks grotesque and is forbidden.",
      "Avoiding music contamination: prompts must forbid music, score, or soundtrack."
    ],
    "working_agreements": [
      "Format discipline is brand, not bureaucracy.",
      "Defaults beat ambiguity: when specs are missing, use the project DNA.",
      "Tools over guesses: use an existing database or workflow first.",
      "Close loops: finish what starts and report status clearly."
    ],
```

**Strength:** Rich, semantic configuration that encodes brand DNA, constraints, and workflows. This is exactly what RAG should store.

#### 4. **Database Schema** ⭐⭐⭐⭐

Your PostgreSQL + pgvector setup is optimal:

```39:111:src/db/schema.ts
export const promptEmbeddings = pgTable(
  'prompt_embeddings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    chunkId: text('chunk_id').notNull().unique(),
    filePath: text('file_path').notNull(),
    chunkText: text('chunk_text').notNull(),
    rawMarkdown: text('raw_markdown').notNull(),
    granularity: varchar('granularity', { length: 20 }).notNull(),
    embedding: vector('embedding', { dimensions: 1536 }).notNull(),
    textsearch: tsvector('textsearch').notNull(),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    checksum: text('checksum').notNull(),
    memoryType: memoryTypeEnum('memory_type').notNull().default('semantic'),
    createdAt: timestamp('created_at', { mode: 'string', withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'string', withTimezone: true }).defaultNow(),
  },
  (table) => ({
    filePathIdx: index('idx_embeddings_file_path').on(table.filePath),
    metadataIdx: index('idx_embeddings_metadata').on(table.metadata),
  }),
);

export const conversationTurns = pgTable(
  'conversation_turns',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sessionId: uuid('session_id').notNull(),
    userId: text('user_id'),
    role: conversationRoleEnum('role').notNull(),
    turnIndex: integer('turn_index').notNull(),
    content: text('content').notNull(),
    summary: jsonb('summary'),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { mode: 'string', withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'string', withTimezone: true }).defaultNow(),
  },
  (table) => ({
    sessionTurnUnique: uniqueIndex('conversation_turns_session_turn_unique').on(
      table.sessionId,
      table.turnIndex,
    ),
  }),
);

export const memoryLinks = pgTable(
  'memory_links',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sourceChunkId: text('source_chunk_id').notNull(),
    targetChunkId: text('target_chunk_id').notNull(),
    linkType: text('link_type').notNull(),
    strength: doublePrecision('strength').notNull(),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { mode: 'string', withTimezone: true }).defaultNow(),
  },
  (table) => ({
    sourceIdx: index('idx_memory_links_source').on(table.sourceChunkId),
    targetIdx: index('idx_memory_links_target').on(table.targetChunkId),
    typeIdx: index('idx_memory_links_type').on(table.linkType),
    uniqueLink: uniqueIndex('memory_links_source_target_type_unique').on(
      table.sourceChunkId,
      table.targetChunkId,
      table.linkType,
    ),
  }),
);
```

**Strength:** Proper indices (GIN for JSONB, vector index), memory type enum, conversation tracking, graph links. This supports all advanced RAG patterns.

---

### ⚠️ What Needs Work

#### 1. **Hard-Coded Workflow Logic** 🔴 CRITICAL

Your workflow orchestration logic is **embedded in n8n workflow JSON** instead of stored in your RAG system.

**Current State:**
- `mylo-mcp-bot.workflow.json` - 1500+ line system prompt hard-coded in JSON
- `generate-ideas.workflow.json` - Idea generation logic hard-coded
- `screen-writer.workflow.json` - Screenplay logic hard-coded
- `generate-video.workflow.json` - Video generation logic hard-coded

**The 4-stage pipeline separation is CORRECT** for:
- ✅ Quality gates between stages
- ✅ HITL approval checkpoints
- ✅ Independent retry/timeout policies
- ✅ Testability of each stage
- ✅ Clear failure boundaries

**Problem:** The orchestration logic WITHIN each workflow is hard-coded.

**Evidence from `mylo-mcp-bot.workflow.json`:**

```13:13:workflows/mylo-mcp-bot.workflow.json
          "systemMessage": "=You are Mylo MCP Bot, an AI orchestrator that assembles persona + project guidance from the MCP vector server, executes their workflows, and returns validated outputs.\n\n## Workflow Inputs\n- personaId: {{$json.personaId}}\n- projectId: {{$json.projectId}}\n...[1500+ lines of hard-coded instructions]...
```

**Why This is a Problem:**

1. **Can't leverage your RAG:** You built procedural memory, memory routing, graph expansion—but workflow instructions aren't stored there
2. **Hard to update:** Changing workflow logic requires editing n8n workflow JSON
3. **Can't A/B test:** No way to test workflow variations
4. **Hard to generalize:** New projects require copying and modifying entire workflows
5. **Not versioned separately:** Workflow logic changes are buried in n8n JSON diffs

**Manual State Passing is Also Brittle:**

```23:52:workflows/AISMR.workflow.json
      "jsCode": "const runResponse = $('Create Run').item?.json ?? {};\nconst run = runResponse.data?.run ?? runResponse.run ?? runResponse;\nif (!run || !run.id) {\n  throw new Error('AISMR workflow could not load run details.');\n}\n...
```

This manual plumbing should be replaced with a proper workflow state manager.

#### 2. **No HITL Implementation** 🔴 CRITICAL

You have a placeholder workflow (`hitl-temp.workflow.json`) but **no actual HITL implementation**. HITL is essential for:

- ✅ Human review of generated ideas before screenplay writing
- ✅ Human approval of screenplay before expensive video generation
- ✅ Human QA of videos before multi-platform publishing
- ✅ Quality control and brand safety
- ✅ Training data for improving future autonomous decisions

**Current State:** Workflows call each other directly with no human review gates.

**What's Needed:**
1. HITL approval UI (web interface for reviewing pending items)
2. n8n wait nodes that pause for human approval
3. Webhook endpoints for approval/rejection
4. Workflow state tracking (pending_approval, approved, rejected)
5. Feedback loop back to episodic memory

#### 3. **Workflow Logic Should Live in RAG** 🔴 CRITICAL

Your 1500+ line system prompt contains **procedural orchestration logic** that should be stored in RAG:

```13:13:workflows/mylo-mcp-bot.workflow.json
"## Task Patterns\n### Idea Generation (AISMR)\n1. conversation.remember → build session exclusion list.\n2. prompts.search (keyword) per descriptor → archive exclusion list.\n3. prompts.search (hybrid + graph) for inspiration.\n..."
```

**Problem:**

1. **Not leveraging procedural memory:** You built memory types for exactly this use case
2. **Hard to update:** Changes require editing n8n JSON and redeploying
3. **Can't A/B test:** No way to test workflow variations
4. **Rigid:** LLM must parse and execute like an instruction manual
5. **Not generalizable:** New projects require copying entire system prompt

**Solution:** Store workflow definitions as procedural memory in RAG, let MCP agents load and execute them dynamically.

#### 4. **Prompt Ingestion is Still File-Based** 🟡 MEDIUM

Your prompt system requires JSON files in `/prompts/`:

```91:114:src/ingestion/ingest.ts
export async function ingestPrompts(options: IngestOptions = {}): Promise<IngestResult> {
  const directory = options.directory ? path.resolve(options.directory) : DEFAULT_PROMPTS_DIR;
  const dryRun = Boolean(options.dryRun);
  const removeMissing = options.removeMissing !== false;
  const repository = options.repository ?? new PromptEmbeddingsRepository();
  const embed = options.embed ?? embedTexts;
  const linkGenerator =
    options.linkGenerator ??
    (dryRun ? null : new MemoryLinkGenerator({ promptRepository: repository }));

  const files = await loadPromptFiles(directory);

  if (files.length === 0) {
    return {
      processed: [],
      removed: [],
      skipped: [],
    };
  }

  const parsed = await Promise.all(
    files.map(async (file) => {
      const document = await readPromptDocument(file.absolutePath);
      return parsePromptDocument(document, file.relativePath);
    }),
  );
```

**Problem:**

- Prompts are version-controlled as files ✅ (good)
- But they must be manually ingested via script ❌ (bad)
- No API to add prompts at runtime ❌
- No versioning of prompts ❌
- No A/B testing of prompts ❌

For generalization beyond AISMR, you'll want to add new project prompts without redeploying.

#### 5. **Operations Database Separation** 🟡 MEDIUM

Your operations database (runs, videos) is separate from the prompt database:

```77:97:src/db/operations/repository.ts
  async createRun(data: CreateRunData): Promise<Run> {
    const timestamp = new Date().toISOString();

    const values: NewRun = {
      id: data.id,
      projectId: data.projectId,
      personaId: (data.personaId ?? null) as NewRun['personaId'],
      chatId: (data.chatId ?? null) as NewRun['chatId'],
      status: data.status ?? 'pending',
      result: (data.result ?? null) as NewRun['result'],
      input: (data.input ?? {}) as NewRun['input'],
      metadata: (data.metadata ?? {}) as NewRun['metadata'],
      startedAt: (data.startedAt ?? null) as NewRun['startedAt'],
      completedAt: (data.completedAt ?? null) as NewRun['completedAt'],
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const [row] = await this.db.insert(schema.runs).values(values).returning();
    return row;
  }
```

**Problem:**

- Prompts are in one database (vector DB)
- Runs/videos are in another database (operations DB)
- No foreign key relationship
- Hard to query "show me all videos created using persona X"
- Hard to track which prompt versions generated which results

This makes analytics and debugging difficult.

---

## Part 2: The North Star Vision

### 🎯 Goal: RAG-Driven 4-Stage Pipeline with HITL

**Current Flow (Hard-Coded Logic):**

```
User → n8n: AISMR.workflow
  → Hard-coded orchestrator with 1500-line system prompt
  → Manual state passing (runId, turnId, sessionId)
  → No HITL gates
  → Direct workflow chaining
```

**Problems:**
- Orchestration logic hard-coded in n8n JSON
- Not leveraging procedural memory
- No human review checkpoints
- Manual state management
- Hard to generalize to new projects

---

### 🚀 North Star Flow (RAG-Driven with HITL)

```
User: "Make me an AISMR video about a lava apple"
↓
┌────────────────────────────────────────────────────────────┐
│  Stage 1: Generate Ideas (n8n workflow)                    │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ 1. Load workflow definition from RAG                 │  │
│  │    → prompts.search(memoryType='procedural')         │  │
│  │                                                       │  │
│  │ 2. Execute via Smart MCP Agent                       │  │
│  │    → conversation.remember (past ideas)              │  │
│  │    → prompts.search (keyword: check archive)         │  │
│  │    → prompts.search (hybrid+graph: inspiration)      │  │
│  │    → Generate 12 unique ideas                        │  │
│  │                                                       │  │
│  │ 3. Validate & Store                                  │  │
│  │    → conversation.store (ideas + uniqueness audit)   │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  Output: 12 validated ideas                                │
└────────────────┬────────────────────────────────────────────┘
                 ↓
            [HITL Gate: Human Reviews & Selects Idea]
                 ↓
┌────────────────────────────────────────────────────────────┐
│  Stage 2: Write Script (n8n workflow)                      │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ 1. Load workflow definition from RAG                 │  │
│  │    → prompts.search(memoryType='procedural')         │  │
│  │                                                       │  │
│  │ 2. Execute via Smart MCP Agent                       │  │
│  │    → prompts.search (keyword: specs - 8s, 3.0s, etc) │  │
│  │    → conversation.remember (past quality issues)     │  │
│  │    → prompts.search (hybrid+graph: successful patterns)│ │
│  │    → Generate screenplay with timestamps             │  │
│  │                                                       │  │
│  │ 3. Validate Guardrails                               │  │
│  │    → Runtime: 8.0s ✓                                 │  │
│  │    → Whisper: 3.0s ✓                                 │  │
│  │    → Max hands: 2 ✓                                  │  │
│  │    → No music: ✓                                     │  │
│  │    → conversation.store (screenplay + validation)    │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  Output: Validated screenplay                              │
└────────────────┬────────────────────────────────────────────┘
                 ↓
            [HITL Gate: Human Approves Script]
                 ↓
┌────────────────────────────────────────────────────────────┐
│  Stage 3: Make Videos (n8n workflow)                       │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ 1. Load video generation config from RAG             │  │
│  │    → Get veo-3-fast settings                         │  │
│  │    → Get Shotstack edit parameters                   │  │
│  │                                                       │  │
│  │ 2. Generate Video                                    │  │
│  │    → Call veo-3-fast API (8s, 9:16, screenplay)     │  │
│  │    → Poll until complete                             │  │
│  │                                                       │  │
│  │ 3. Edit with Shotstack                               │  │
│  │    → Add timing overlays                             │  │
│  │    → Add audio (whisper at 3.0s)                     │  │
│  │    → Export final video                              │  │
│  │                                                       │  │
│  │ 4. Store Video Artifact                              │  │
│  │    → conversation.store (video metadata)             │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  Output: Finished video URL                                │
└────────────────┬────────────────────────────────────────────┘
                 ↓
            [HITL Gate: Human QA's Video]
                 ↓
┌────────────────────────────────────────────────────────────┐
│  Stage 4: Post Video (n8n workflow)                        │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ 1. Load publishing config from RAG                   │  │
│  │    → Get platform settings (TikTok, YT, IG)          │  │
│  │    → Get caption/hashtag templates                   │  │
│  │                                                       │  │
│  │ 2. Publish to Platforms (parallel)                   │  │
│  │    → TikTok: Upload + caption + schedule             │  │
│  │    → YouTube Shorts: Upload + title + description    │  │
│  │    → Instagram Reels: Upload + caption + hashtags    │  │
│  │                                                       │  │
│  │ 3. Store Publishing Results                          │  │
│  │    → conversation.store (URLs + engagement tracking) │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  Output: Published URLs + metadata                         │
└─────────────────────────────────────────────────────────────┘
```

**Key Improvements:**
- ✅ **4 separate n8n workflows** (one per stage, enables HITL gates)
- ✅ **Workflow logic stored in RAG** (procedural memory)
- ✅ **HITL gates between stages** (human review/approval)
- ✅ **Smart MCP agents** (load instructions from RAG dynamically)
- ✅ **Leverages advanced RAG** (memory routing, graph expansion, adaptive search)
- ✅ **n8n for integrations** (veo-3-fast, Shotstack, TikTok APIs)
- ✅ **Clean state management** (workflow runs table)
- ✅ **Easy to generalize** (add new project prompts to RAG)

---

### 🏗️ Architecture Pattern: RAG-Driven n8n Workflows

**Key Innovation:** Keep n8n workflows but make them **smart by loading logic from RAG**:

1. **n8n provides:** UI, integrations (veo-3-fast, Shotstack, TikTok), workflow engine, state management
2. **RAG provides:** Workflow definitions, orchestration logic, validation rules, schemas
3. **MCP agents provide:** Intelligent execution, decision-making, context gathering

**Architecture:**

```
┌─────────────────────────────────────────────────────────┐
│  n8n Workflow (Thin Shell)                              │
│  ┌───────────────────────────────────────────────────┐  │
│  │ 1. Webhook Trigger                                │  │
│  │ 2. Create Workflow Run Record                     │  │
│  │ 3. Smart MCP Agent Node ←──────────┐              │  │
│  │    - Loads workflow from RAG       │              │  │
│  │    - Executes steps autonomously   │              │  │
│  │ 4. Quality Gate Check              │              │  │
│  │ 5. [HITL Wait Node] (optional)     │              │  │
│  │ 6. Trigger Next Stage or Return    │              │  │
│  └───────────────────────────────────┬───────────────┘  │
└────────────────────────────────────────┼──────────────────┘
                                        │
                      ┌─────────────────┴─────────────────┐
                      │  RAG System (Knowledge)           │
                      │  ┌─────────────────────────────┐  │
                      │  │ Procedural Memory:          │  │
                      │  │ - Workflow definitions      │  │
                      │  │ - Step-by-step instructions │  │
                      │  │ - Validation rules          │  │
                      │  │ - Error handling strategies │  │
                      │  │                             │  │
                      │  │ Project Memory:             │  │
                      │  │ - AISMR specs (8s, 3.0s)    │  │
                      │  │ - veo-3-fast configs        │  │
                      │  │ - Shotstack templates       │  │
                      │  │                             │  │
                      │  │ Episodic Memory:            │  │
                      │  │ - Past ideas                │  │
                      │  │ - Quality issues            │  │
                      │  │ - Successful patterns       │  │
                      │  └─────────────────────────────┘  │
                      └─────────────────────────────────────┘
```

**Example: Smart MCP Agent Node**

```json
{
  "name": "Smart Idea Generation Agent",
  "type": "@n8n/n8n-nodes-langchain.agent",
  "parameters": {
    "mcpServers": ["mcp-prompts"],
    "systemMessage": "You are an autonomous workflow executor.

1. Load your workflow definition from RAG:
   prompts.search({
     query: 'idea generation workflow instructions',
     project: '{{ $json.project }}',
     memoryType: 'procedural',
     limit: 1
   })

2. Execute the loaded workflow steps exactly as defined

3. Use advanced RAG features as specified in the workflow:
   - conversation.remember for context
   - prompts.search with memory routing for specs
   - prompts.search with graph expansion for inspiration
   - prompts_search_adaptive when uncertain

4. Validate outputs against schemas in the workflow

5. Return structured results matching the output format

The workflow definition is your complete playbook.",
    "input": "={{ $json }}"
  }
}
```

**Benefits:**

1. ✅ **Keep n8n's strengths:** UI, integrations, visual debugging
2. ✅ **Leverage RAG fully:** Procedural memory, memory routing, graph expansion
3. ✅ **Easy to update:** Change workflow logic by updating RAG, not n8n JSON
4. ✅ **HITL-ready:** n8n wait nodes between stages
5. ✅ **Generalizable:** Add new projects by adding prompts to RAG
6. ✅ **Observable:** Execution traces in episodic memory + n8n UI
7. ✅ **Stage separation:** Quality gates, independent failures, testability

---

### 🎨 Key Architectural Changes

#### Change 1: Keep 4-Stage Pipeline, Add HITL Gates

**Current:** 4 workflows with hard-coded logic, no HITL  
**North Star:** 4 workflows with RAG-driven logic + HITL gates

```
workflows/
├─ 1-generate-ideas.workflow.json      [Loads logic from RAG]
│  └─ [HITL Gate: Human selects idea]
├─ 2-write-script.workflow.json        [Loads logic from RAG]
│  └─ [HITL Gate: Human approves script]
├─ 3-make-videos.workflow.json         [Loads logic from RAG]
│  └─ [HITL Gate: Human QA's video]
└─ 4-post-video.workflow.json          [Loads logic from RAG]
   └─ Done: Video published
```

**Why Keep Separate Workflows:**
- ✅ Quality gates between stages (critical for HITL)
- ✅ Independent failure handling
- ✅ Different retry/timeout policies per stage
- ✅ Clear observability (see which stage failed)
- ✅ Testable in isolation

#### Change 2: Move Workflow Logic from n8n JSON to RAG

**Before:** 1500-line system prompt hard-coded in n8n workflow  
**After:** Workflow definitions stored in RAG (procedural memory)

**Workflow Definition in RAG (`prompts/workflows/aismr-idea-generation.json`):**

```json
{
  "title": "AISMR Idea Generation Workflow",
  "memoryType": "procedural",
  "project": ["aismr"],
  "persona": ["ideagenerator"],
  "workflow": {
    "steps": [
      {
        "step": 1,
        "action": "Load persona configuration",
        "mcp_call": {
          "tool": "prompt_get",
          "params": {
            "persona_name": "ideagenerator",
            "project_name": "aismr"
          }
        }
      },
      {
        "step": 2,
        "action": "Gather exclusion context",
        "parallel_calls": [
          {
            "tool": "conversation.remember",
            "params": {
              "sessionId": "${input.sessionId}",
              "query": "past AISMR ideas",
              "limit": 100
            }
          },
          {
            "tool": "prompts.search",
            "params": {
              "query": "${input.userInput}",
              "project": "aismr",
              "searchMode": "keyword",
              "useMemoryRouting": true
            }
          }
        ]
      },
      {
        "step": 3,
        "action": "Find creative inspiration",
        "mcp_call": {
          "tool": "prompts.search",
          "params": {
            "query": "successful AISMR sensory patterns",
            "searchMode": "hybrid",
            "expandGraph": true,
            "maxHops": 2,
            "temporalBoost": true
          }
        }
      },
      {
        "step": 4,
        "action": "Generate 12 unique ideas with validation",
        "llm_generation": {
          "model": "gpt-4",
          "validation": {
            "idea_count": 12,
            "uniqueness_check": true
          }
        }
      },
      {
        "step": 5,
        "action": "Store results",
        "mcp_call": {
          "tool": "conversation.store",
          "params": {
            "sessionId": "${input.sessionId}",
            "content": "${generation_result}"
          }
        }
      }
    ]
  }
}
```

**Smart n8n Agent (Executes workflow from RAG):**

```json
{
  "name": "Smart Idea Generation Agent",
  "type": "@n8n/n8n-nodes-langchain.agent",
  "parameters": {
    "systemMessage": "Load workflow from RAG and execute autonomously",
    "mcpServers": ["mcp-prompts"]
  }
}
```

#### Change 3: Add HITL Schema and Workflow State Management

**Add to operations database:**

```sql
-- Workflow run state with stage tracking
CREATE TABLE workflow_runs (
  id uuid PRIMARY KEY,
  project_id text NOT NULL,
  session_id uuid NOT NULL,
  current_stage text NOT NULL, -- idea_generation, screenplay, video_generation, publishing
  status text NOT NULL, -- running, waiting_for_hitl, completed, failed
  
  -- Stage status tracking
  stages jsonb NOT NULL DEFAULT '{
    "idea_generation": {"status": "pending"},
    "screenplay": {"status": "pending"},
    "video_generation": {"status": "pending"},
    "publishing": {"status": "pending"}
  }',
  
  input jsonb NOT NULL,
  output jsonb,
  
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- HITL approval tracking
CREATE TABLE hitl_approvals (
  id uuid PRIMARY KEY,
  workflow_run_id uuid REFERENCES workflow_runs(id),
  stage text NOT NULL, -- idea_generation, screenplay, video_generation
  content jsonb NOT NULL, -- what needs approval
  
  status text NOT NULL, -- pending, approved, rejected
  reviewed_by text, -- user who reviewed
  reviewed_at timestamptz,
  feedback text, -- human feedback
  
  created_at timestamptz DEFAULT now()
);

-- Link workflow definition to executions
ALTER TABLE workflow_runs ADD COLUMN workflow_definition_chunk_id text;
ALTER TABLE workflow_runs ADD FOREIGN KEY (workflow_definition_chunk_id) 
  REFERENCES prompt_embeddings(chunk_id);
```

**HITL Workflow Pattern:**

```typescript
// After idea generation
await hitlService.requestApproval({
  workflowRunId,
  stage: 'idea_generation',
  content: { ideas: generatedIdeas },
  notifyChannels: ['slack', 'email']
});

// n8n workflow waits
{
  "name": "Wait for HITL Approval",
  "type": "n8n-nodes-base.wait",
  "parameters": {
    "resume": "webhook",
    "options": {
      "webhook": {
        "path": "hitl/approve/{{ $json.workflowRunId }}"
      }
    }
  }
}

// Human approves via UI
POST /api/hitl/approve/{workflowRunId}
{
  "stage": "idea_generation",
  "selectedIdea": {...},
  "feedback": "Love the lava apple concept!"
}

// Workflow resumes with approval data
```

Now you can:
- Track which human approved each stage
- Store feedback for improving future generations
- Query approval bottlenecks
- Build training datasets from approved/rejected items

#### Change 4: Runtime Prompt Management

**Add API endpoints:**

```typescript
// POST /api/prompts
async createPrompt(prompt: PromptDefinition): Promise<PromptId>

// PUT /api/prompts/:id
async updatePrompt(id: PromptId, prompt: PromptDefinition): Promise<void>

// GET /api/prompts/:id/versions
async listPromptVersions(id: PromptId): Promise<PromptVersion[]>

// POST /api/prompts/:id/deploy
async deployPromptVersion(id: PromptId, version: number): Promise<void>
```

**Benefits:**

- Add new projects without redeploying
- A/B test prompt variations
- Rollback bad prompts instantly
- Track which prompt version generated which results

#### Change 5: Workflow Definition Language

**Create a schema for workflows:**

```typescript
interface WorkflowDefinition {
  id: string;
  name: string;
  version: string;
  steps: WorkflowStep[];
  schemas: Record<string, JSONSchema>;
  guardrails: Guardrail[];
}

interface WorkflowStep {
  id: string;
  type: 'mcp_call' | 'llm_call' | 'api_call' | 'validation' | 'conditional';
  dependsOn?: string[]; // step IDs
  params: Record<string, unknown>;
  validation?: ValidationRule[];
  retry?: RetryPolicy;
  fallback?: WorkflowStep;
}

interface Guardrail {
  type: 'schema' | 'uniqueness' | 'timing' | 'content_filter';
  rule: ValidationRule;
  onViolation: 'halt' | 'retry' | 'fallback';
}
```

**Store this in prompts:**

```json
{
  "title": "AISMR Video Generation Workflow",
  "workflow": {
    "id": "aismr-video-gen",
    "version": "2.0",
    "steps": [
      {
        "id": "load_history",
        "type": "mcp_call",
        "tool": "conversation.remember",
        "params": {
          "sessionId": "${context.sessionId}",
          "query": "past AISMR ideas",
          "limit": 50
        }
      },
      {
        "id": "check_archive",
        "type": "api_call",
        "endpoint": "GET /api/videos",
        "params": { "project": "aismr", "status": ["published"] }
      },
      {
        "id": "generate_ideas",
        "type": "llm_call",
        "dependsOn": ["load_history", "check_archive"],
        "model": "gpt-4",
        "prompt": "${prompts.ideaGeneration}",
        "schema": "${schemas.ideaOutput}",
        "validation": [
          { "type": "count", "field": "ideas", "min": 12, "max": 12 },
          { "type": "uniqueness", "against": ["${load_history.ideas}", "${check_archive.ideas}"] }
        ],
        "retry": { "maxAttempts": 3, "backoff": "exponential" }
      },
      ...
    ]
  }
}
```

**Execute with:**

```typescript
const orchestrator = new VideoGenerationOrchestrator(mcpClient, operationsRepo);
const result = await orchestrator.generateVideo({
  workflowId: 'aismr-video-gen',
  userInput: 'lava apple',
  sessionId: '...',
});
```

**The orchestrator:**

1. Loads the workflow definition via RAG
2. Parses the steps
3. Builds a dependency graph
4. Executes steps in topological order
5. Validates at each step
6. Handles retries and fallbacks
7. Stores execution trace

---

## Part 3: Specific Recommendations

### 🔥 Priority 1: Implement HITL Gates

**Goal:** Add human-in-the-loop review/approval at each stage.

**Steps:**

1. **Create HITL service** (`src/services/hitl/`)

```typescript
// src/services/hitl/HITLService.ts
export class HITLService {
  constructor(
    private operationsRepo: OperationsRepository,
    private notificationService: NotificationService,
  ) {}

  async requestApproval(params: {
    workflowRunId: string;
    stage: string;
    content: unknown;
    notifyChannels?: string[];
  }): Promise<HITLApproval> {
    // Create approval record
    const approval = await this.operationsRepo.createHITLApproval({
      workflowRunId: params.workflowRunId,
      stage: params.stage,
      content: params.content,
      status: 'pending',
    });

    // Update workflow run status
    await this.operationsRepo.updateWorkflowRun(params.workflowRunId, {
      status: 'waiting_for_hitl',
      [`stages.${params.stage}.status`]: 'awaiting_approval',
    });

    // Notify human reviewers
    await this.notificationService.notify({
      channels: params.notifyChannels || ['slack'],
      message: `New ${params.stage} awaiting approval`,
      link: `/hitl/review/${approval.id}`,
      data: params.content,
    });

    return approval;
  }

  async approve(approvalId: string, params: {
    reviewedBy: string;
    selectedItem?: unknown;
    feedback?: string;
  }): Promise<void> {
    const approval = await this.operationsRepo.getHITLApproval(approvalId);
    
    // Update approval status
    await this.operationsRepo.updateHITLApproval(approvalId, {
      status: 'approved',
      reviewedBy: params.reviewedBy,
      reviewedAt: new Date(),
      feedback: params.feedback,
    });

    // Resume workflow via webhook
    await this.resumeWorkflow(approval.workflowRunId, {
      stage: approval.stage,
      approved: true,
      selectedItem: params.selectedItem,
      feedback: params.feedback,
    });

    // Store approval in episodic memory
    await this.storeApprovalInMemory(approval, params);
  }

  async reject(approvalId: string, params: {
    reviewedBy: string;
    reason: string;
  }): Promise<void> {
    const approval = await this.operationsRepo.getHITLApproval(approvalId);
    
    await this.operationsRepo.updateHITLApproval(approvalId, {
      status: 'rejected',
      reviewedBy: params.reviewedBy,
      reviewedAt: new Date(),
      feedback: params.reason,
    });

    // Update workflow to failed/needs_revision
    await this.operationsRepo.updateWorkflowRun(approval.workflowRunId, {
      status: 'needs_revision',
      [`stages.${approval.stage}.status`]: 'rejected',
    });

    // Store rejection in episodic memory for learning
    await this.storeRejectionInMemory(approval, params);
  }

  private async resumeWorkflow(workflowRunId: string, data: unknown): Promise<void> {
    // Trigger n8n webhook to resume workflow
    await fetch(`${N8N_WEBHOOK_BASE}/hitl/resume/${workflowRunId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  }
}
```

2. **Add HITL API routes** (`src/server/routes/hitl.ts`)

```typescript
// GET /api/hitl/pending
// List all pending approvals for UI
router.get('/pending', async (req, res) => {
  const approvals = await hitlService.getPendingApprovals({
    stage: req.query.stage as string,
    project: req.query.project as string,
  });
  res.json({ approvals });
});

// GET /api/hitl/approval/:id
// Get specific approval details
router.get('/approval/:id', async (req, res) => {
  const approval = await hitlService.getApproval(req.params.id);
  res.json({ approval });
});

// POST /api/hitl/approve/:id
// Approve an item
router.post('/approve/:id', async (req, res) => {
  await hitlService.approve(req.params.id, {
    reviewedBy: req.body.reviewedBy,
    selectedItem: req.body.selectedItem,
    feedback: req.body.feedback,
  });
  res.json({ success: true });
});

// POST /api/hitl/reject/:id
// Reject an item
router.post('/reject/:id', async (req, res) => {
  await hitlService.reject(req.params.id, {
    reviewedBy: req.body.reviewedBy,
    reason: req.body.reason,
  });
  res.json({ success: true });
});
```

3. **Update n8n workflows to include HITL gates**

```json
// workflows/1-generate-ideas.workflow.json
{
  "nodes": [
    // ... idea generation nodes ...
    {
      "name": "Request HITL Approval",
      "type": "n8n-nodes-base.httpRequest",
      "parameters": {
        "url": "https://mcp-vector.mjames.dev/api/hitl/request-approval",
        "method": "POST",
        "body": {
          "workflowRunId": "={{ $json.workflowRunId }}",
          "stage": "idea_generation",
          "content": "={{ $json.ideas }}",
          "notifyChannels": ["slack", "email"]
        }
      }
    },
    {
      "name": "Wait for Human Approval",
      "type": "n8n-nodes-base.wait",
      "parameters": {
        "resume": "webhook",
        "options": {
          "webhook": {
            "path": "hitl/resume/={{ $json.workflowRunId }}"
          }
        }
      }
    },
    {
      "name": "Check Approval Status",
      "type": "n8n-nodes-base.if",
      "parameters": {
        "conditions": {
          "boolean": [
            {
              "value1": "={{ $json.approved }}",
              "value2": true
            }
          ]
        }
      }
    },
    {
      "name": "Trigger Script Writing",
      "type": "n8n-nodes-base.httpRequest",
      "parameters": {
        "url": "http://localhost:5678/webhook/write-script",
        "method": "POST",
        "body": {
          "workflowRunId": "={{ $json.workflowRunId }}",
          "selectedIdea": "={{ $json.selectedItem }}",
          "humanFeedback": "={{ $json.feedback }}"
        }
      }
    }
  ]
}
```

4. **Build HITL approval UI** (React/Next.js)

```typescript
// pages/hitl/pending.tsx
export default function PendingApprovals() {
  const { data: approvals } = useQuery('pendingApprovals', 
    () => fetch('/api/hitl/pending').then(r => r.json())
  );

  return (
    <div>
      <h1>Pending Approvals</h1>
      {approvals?.map(approval => (
        <ApprovalCard
          key={approval.id}
          approval={approval}
          onApprove={(selectedItem, feedback) => 
            approveMutation.mutate({ id: approval.id, selectedItem, feedback })
          }
          onReject={(reason) =>
            rejectMutation.mutate({ id: approval.id, reason })
          }
        />
      ))}
    </div>
  );
}
```

**Benefits:**
- ✅ Human quality control at each stage
- ✅ Training data for future autonomous improvements
- ✅ Feedback loop to episodic memory
- ✅ Approval/rejection analytics
- ✅ Slack/email notifications for reviewers

---

### 🔥 Priority 2: Move Workflow Logic to RAG

**Goal:** Store workflow orchestration logic in RAG (procedural memory) instead of hard-coding in n8n JSON.

**Steps:**

1. **Create workflow definition schema**

Create a JSON schema for procedural memory workflow definitions:

```typescript
// src/types/workflow.ts
export interface WorkflowDefinition {
  title: string;
  memoryType: 'procedural';
  project: string[];
  persona?: string[];
  workflow: {
    name: string;
    description: string;
    steps: WorkflowStep[];
    validation?: ValidationRules;
    output_format?: unknown;
  };
}

export interface WorkflowStep {
  step: number;
  action: string;
  mcp_call?: MCPCall;
  parallel_calls?: MCPCall[];
  llm_generation?: LLMGeneration;
  api_call?: APICall;
  validation?: ValidationRules;
  on_validation_failure?: FailureStrategy;
}
```

2. **Create workflow definitions for each stage**

Store these in `prompts/workflows/`:

```json
// prompts/workflows/aismr-idea-generation-workflow.json
{
  "title": "AISMR Idea Generation Workflow",
  "memoryType": "procedural",
  "project": ["aismr"],
  "persona": ["ideagenerator"],
  "workflow": {
    "name": "Generate Ideas",
    "description": "Generate 12 unique AISMR video ideas with uniqueness validation",
    "steps": [
      {
        "id": "remember_past_ideas",
        "type": "mcp_call",
        "tool": "conversation.remember",
        "params": {
          "sessionId": "${context.sessionId}",
          "query": "past AISMR ideas",
          "limit": 50
        }
      },
      {
        "id": "search_archive",
        "type": "mcp_call",
        "tool": "prompts.search",
        "params": {
          "query": "${context.userInput}",
          "project": "aismr",
          "searchMode": "keyword",
          "limit": 20
        }
      },
      {
        "id": "generate_ideas",
        "type": "llm_call",
        "dependsOn": ["remember_past_ideas", "search_archive"],
        "model": "gpt-4",
        "prompt": "Generate 12 unique AISMR ideas about ${context.userInput}...",
        "schema": {
          "type": "object",
          "properties": {
            "userIdea": { "type": "string" },
            "ideas": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "idea": { "type": "string" },
                  "vibe": { "type": "string" }
                }
              },
              "minItems": 12,
              "maxItems": 12
            }
          }
        },
        "validation": [
          {
            "type": "uniqueness",
            "against": ["${remember_past_ideas.ideas}", "${search_archive.results}"],
            "onViolation": "halt"
          }
        ]
      },
      {
        "id": "store_result",
        "type": "mcp_call",
        "tool": "conversation.store",
        "params": {
          "sessionId": "${context.sessionId}",
          "role": "assistant",
          "content": "${generate_ideas.data}",
          "metadata": {
            "stage": "idea_generation",
            "uniquenessAudit": "${generate_ideas.validation}"
          }
        }
      }
    ]
  }
}
```

```

3. **Ingest workflow definitions into RAG**

```bash
npm run ingest:prompts
```

4. **Update MCP agents to load workflows from RAG**

Simplify n8n agent system prompts:

```json
{
  "name": "Smart Idea Generation Agent",
  "type": "@n8n/n8n-nodes-langchain.agent",
  "parameters": {
    "mcpServers": ["mcp-prompts"],
    "systemMessage": "You are an autonomous workflow executor.

1. Load workflow definition from RAG:
   prompts.search({
     query: 'idea generation workflow',
     project: '{{ $json.project }}',
     memoryType: 'procedural'
   })

2. Execute workflow steps exactly as defined in the loaded definition

3. Use MCP tools with parameters from the workflow

4. Validate against schemas in the workflow

5. Return results matching output_format",
    "input": "={{ $json }}"
  }
}
```

**Benefits:**

- ✅ Update workflow logic by editing prompts, not n8n JSON
- ✅ A/B test workflow variations
- ✅ Leverage advanced RAG (memory routing, graph expansion, adaptive search)
- ✅ Version control workflow logic separately
- ✅ Generalize to new projects easily

---

### 🔥 Priority 3: Generalize Beyond AISMR

**Goal:** Make the system project-agnostic.

**Current Problem:** Everything is hardcoded for AISMR:

- Workflow names have "AISMR" in them
- Schemas reference AISMR-specific fields
- Validations hardcoded (8s runtime, 3.0s whisper, etc.)

**Solution:** Extract project-specific logic into prompts.

**Steps:**

1. **Create a generic workflow template:**

```json
{
  "id": "generic-video-generation",
  "workflow": {
    "steps": [
      {
        "id": "load_project_config",
        "type": "mcp_call",
        "tool": "prompt_get",
        "params": {
          "project_name": "${context.projectId}"
        }
      },
      {
        "id": "load_persona_config",
        "type": "mcp_call",
        "tool": "prompt_get",
        "params": {
          "persona_name": "${context.personaId}"
        }
      },
      {
        "id": "generate_content",
        "type": "llm_call",
        "prompt": "${load_persona_config.persona.role}: ${load_project_config.workflow.taskDescription}",
        "schema": "${load_project_config.workflow.outputSchema}",
        "validation": "${load_project_config.workflow.guardrails}"
      },
      {
        "id": "validate_output",
        "type": "validation",
        "rules": "${load_project_config.evaluation_criteria}"
      },
      {
        "id": "generate_artifact",
        "type": "api_call",
        "endpoint": "${load_project_config.generation_api}",
        "params": {
          "prompt": "${generate_content.data}",
          "config": "${load_project_config.generation_config}"
        }
      }
    ]
  }
}
```

2. **Create project-specific configs:**

`prompts/projects/youtube-shorts.json`:

```json
{
  "id": "youtube-shorts",
  "title": "YouTube Shorts Generator",
  "workflow": {
    "taskDescription": "Generate engaging YouTube Shorts ideas",
    "outputSchema": {
      "type": "object",
      "properties": {
        "title": { "type": "string", "maxLength": 100 },
        "description": { "type": "string", "maxLength": 5000 },
        "tags": { "type": "array", "items": { "type": "string" } }
      }
    },
    "guardrails": [
      { "type": "duration", "min": 15, "max": 60 },
      { "type": "content_filter", "blacklist": ["violence", "explicit"] }
    ]
  },
  "generation_api": "https://api.shorts-generator.com/v1/generate",
  "generation_config": {
    "aspect_ratio": "9:16",
    "max_duration": 60
  }
}
```

`prompts/projects/podcast-clips.json`:

```json
{
  "id": "podcast-clips",
  "title": "Podcast Clip Generator",
  "workflow": {
    "taskDescription": "Extract engaging clips from podcast transcripts",
    "outputSchema": {
      "type": "object",
      "properties": {
        "clips": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "start_time": { "type": "number" },
              "end_time": { "type": "number" },
              "transcript": { "type": "string" },
              "hook": { "type": "string" }
            }
          }
        }
      }
    },
    "guardrails": [
      { "type": "duration", "min": 30, "max": 90 },
      { "type": "coherence", "ensure_complete_thought": true }
    ]
  },
  "generation_api": "https://api.clip-extractor.com/v1/extract",
  "generation_config": {
    "format": "mp4",
    "add_captions": true
  }
}
```

3. **Use the same orchestrator for all projects:**

```typescript
// Generate AISMR video
await orchestrator.generateVideo({
  workflowId: 'generic-video-generation',
  projectId: 'aismr',
  personaId: 'ideagenerator',
  userInput: 'lava apple',
});

// Generate YouTube Short
await orchestrator.generateVideo({
  workflowId: 'generic-video-generation',
  projectId: 'youtube-shorts',
  personaId: 'content-creator',
  userInput: 'top 5 productivity hacks',
});

// Generate podcast clip
await orchestrator.generateVideo({
  workflowId: 'generic-video-generation',
  projectId: 'podcast-clips',
  personaId: 'editor',
  userInput: 'most engaging moment from episode 42',
});
```

**The orchestrator loads the project config and adapts automatically.**

---

### 🔥 Priority 3: Add Workflow Versioning & A/B Testing

**Goal:** Iterate on workflows without breaking production.

**Steps:**

1. **Add versioning to workflow definitions:**

```json
{
  "id": "aismr-video-gen",
  "version": "2.1.0",
  "changelog": "Improved uniqueness checking with graph expansion",
  "created_at": "2025-11-01T00:00:00Z",
  "workflow": { ... }
}
```

2. **Store workflow versions in database:**

```sql
CREATE TABLE workflow_versions (
  id uuid PRIMARY KEY,
  workflow_id text NOT NULL,
  version text NOT NULL,
  chunk_id text REFERENCES prompt_embeddings(chunk_id),
  is_active boolean DEFAULT false,
  rollout_percentage integer DEFAULT 0, -- for A/B testing
  created_at timestamptz DEFAULT now(),
  UNIQUE(workflow_id, version)
);
```

3. **Implement version selection in orchestrator:**

```typescript
private async loadWorkflow(workflowId: string, version?: string): Promise<WorkflowDefinition> {
  if (version) {
    // Load specific version
    return this.loadWorkflowVersion(workflowId, version);
  }

  // Load active version with A/B testing
  const activeVersions = await this.getActiveVersions(workflowId);

  if (activeVersions.length === 1) {
    return this.loadWorkflowVersion(workflowId, activeVersions[0].version);
  }

  // Multiple active versions → A/B test
  const selectedVersion = this.selectVersionByRollout(activeVersions);
  return this.loadWorkflowVersion(workflowId, selectedVersion.version);
}

private selectVersionByRollout(versions: WorkflowVersion[]): WorkflowVersion {
  const rand = Math.random() * 100;
  let cumulative = 0;

  for (const version of versions) {
    cumulative += version.rollout_percentage;
    if (rand < cumulative) {
      return version;
    }
  }

  return versions[versions.length - 1]; // fallback
}
```

4. **Add API to manage versions:**

```typescript
// Deploy new version
POST /api/workflows/aismr-video-gen/versions
{
  "version": "2.1.0",
  "workflow": { ... }
}

// Gradually roll out
PATCH /api/workflows/aismr-video-gen/versions/2.1.0
{
  "rollout_percentage": 10  // start with 10%
}

// Monitor performance, then increase
PATCH /api/workflows/aismr-video-gen/versions/2.1.0
{
  "rollout_percentage": 50
}

// Full rollout
PATCH /api/workflows/aismr-video-gen/versions/2.1.0
{
  "rollout_percentage": 100
}

// Rollback
PATCH /api/workflows/aismr-video-gen/versions/2.0.0
{
  "rollout_percentage": 100
}
```

**Benefits:**

- ✅ Test new workflows with 10% of traffic
- ✅ Compare success rates between versions
- ✅ Instant rollback if new version fails
- ✅ Track which version generated each result

---

### 🔥 Priority 4: Improve Observability

**Goal:** Understand what's happening in production.

**Steps:**

1. **Add execution tracing:**

```typescript
interface ExecutionTrace {
  executionId: string;
  workflowId: string;
  workflowVersion: string;
  sessionId: string;
  startedAt: Date;
  completedAt: Date;
  status: 'success' | 'failed' | 'partial';
  steps: StepTrace[];
  totalDuration: number;
  tokenUsage: number;
  cost: number;
}

interface StepTrace {
  stepId: string;
  stepType: string;
  startedAt: Date;
  completedAt: Date;
  duration: number;
  inputHash: string;
  outputHash: string;
  success: boolean;
  error?: string;
  mcpCalls?: MCPCallTrace[];
  llmCalls?: LLMCallTrace[];
}
```

2. **Store traces in episodic memory:**

```typescript
async storeTrace(trace: ExecutionTrace): Promise<void> {
  await this.conversationRepo.storeConversationTurn({
    sessionId: trace.sessionId,
    role: 'assistant',
    content: JSON.stringify(trace),
    summary: {
      executionId: trace.executionId,
      workflowId: trace.workflowId,
      status: trace.status,
      duration: trace.totalDuration
    },
    metadata: {
      type: 'execution_trace',
      workflowVersion: trace.workflowVersion,
      stepCount: trace.steps.length,
      tokenUsage: trace.tokenUsage,
      cost: trace.cost
    }
  });
}
```

3. **Add dashboard queries:**

```typescript
// Success rate by workflow version
SELECT
  workflow_id,
  workflow_version,
  COUNT(*) as total_executions,
  COUNT(*) FILTER (WHERE status = 'success') as successes,
  AVG(total_duration) as avg_duration_ms,
  SUM(token_usage) as total_tokens,
  SUM(cost) as total_cost
FROM execution_traces
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY workflow_id, workflow_version
ORDER BY total_executions DESC;

// Failure analysis
SELECT
  workflow_id,
  step_id,
  error_type,
  COUNT(*) as failure_count,
  AVG(duration) as avg_duration_before_failure
FROM execution_traces
JOIN step_traces ON execution_traces.id = step_traces.execution_id
WHERE step_traces.success = false
GROUP BY workflow_id, step_id, error_type
ORDER BY failure_count DESC;

// Slow steps
SELECT
  workflow_id,
  step_id,
  step_type,
  AVG(duration) as avg_duration_ms,
  MAX(duration) as max_duration_ms,
  COUNT(*) as executions
FROM step_traces
GROUP BY workflow_id, step_id, step_type
HAVING AVG(duration) > 5000  -- steps taking >5s
ORDER BY avg_duration_ms DESC;
```

4. **Add real-time monitoring:**

```typescript
// Emit events for monitoring
class WorkflowExecutor {
  async executeStep(step: WorkflowStep): Promise<StepResult> {
    const startTime = Date.now();

    try {
      const result = await this._executeStep(step);

      this.emit('step:success', {
        workflowId: this.workflow.id,
        stepId: step.id,
        duration: Date.now() - startTime,
      });

      return result;
    } catch (error) {
      this.emit('step:failure', {
        workflowId: this.workflow.id,
        stepId: step.id,
        error: error.message,
        duration: Date.now() - startTime,
      });

      throw error;
    }
  }
}

// Subscribe to events
orchestrator.on('step:failure', async (event) => {
  // Alert on high failure rate
  const recentFailures = await getFailureCount(event.workflowId, event.stepId, '5m');

  if (recentFailures > 10) {
    await sendAlert({
      severity: 'high',
      message: `Step ${event.stepId} in workflow ${event.workflowId} failing repeatedly`,
      count: recentFailures,
    });
  }
});
```

**Benefits:**

- ✅ See which workflows/steps are slow or failing
- ✅ Debug production issues with full execution trace
- ✅ Optimize expensive steps
- ✅ Alert on anomalies

---

### 🔥 Priority 5: Clean Up Technical Debt

#### 5.1: Remove Duplicate Code

You have duplicate workflow orchestration logic in:

- `mylo-mcp-bot.workflow.json` (1500-line system prompt)
- `AISMR.workflow.json` (JavaScript context assembly)
- `screen-writer.workflow.json` (similar orchestration)
- `generate-ideas.workflow.json` (similar orchestration)

**Consolidate into the orchestrator.**

#### 5.2: Unify Database Access

You have two separate databases:

- Prompt database (PostgreSQL + pgvector)
- Operations database (Supabase)

**Either:**

1. Merge them into one database with proper schema design
2. Or add a data layer that abstracts over both

**Recommended:**

```typescript
// src/data/DataRepository.ts
export class DataRepository {
  constructor(
    private promptRepo: PromptEmbeddingsRepository,
    private operationsRepo: OperationsRepository,
  ) {}

  async getExecutionContext(executionId: string): Promise<ExecutionContext> {
    const run = await this.operationsRepo.getRunById(executionId);
    const videos = await this.operationsRepo.listVideosByRun(executionId);
    const conversation = await this.promptRepo.searchEpisodicMemory({
      // ...
    });

    return {
      run,
      videos,
      conversation,
    };
  }

  async storeExecutionResult(result: ExecutionResult): Promise<void> {
    // Store in both databases transactionally
    await Promise.all([
      this.operationsRepo.updateRun(result.runId, {
        status: result.status,
        result: result.output,
      }),
      this.promptRepo.storeConversationTurn({
        sessionId: result.sessionId,
        role: 'assistant',
        content: result.output,
      }),
    ]);
  }
}
```

#### 5.3: Add Type Safety

Your n8n workflows pass data as untyped JSON. This makes debugging hard.

**Add Zod schemas:**

```typescript
// src/schemas/workflow.ts
import { z } from 'zod';

export const VideoGenerationRequestSchema = z.object({
  workflowId: z.string().optional(),
  projectId: z.string(),
  personaId: z.string(),
  sessionId: z.string().uuid(),
  userInput: z.string(),
});

export type VideoGenerationRequest = z.infer<typeof VideoGenerationRequestSchema>;

export const VideoGenerationResultSchema = z.object({
  executionId: z.string().uuid(),
  status: z.enum(['success', 'failed', 'partial']),
  artifacts: z.array(
    z.object({
      type: z.string(),
      url: z.string(),
    }),
  ),
  metadata: z.record(z.unknown()),
});

export type VideoGenerationResult = z.infer<typeof VideoGenerationResultSchema>;
```

**Validate at boundaries:**

```typescript
async generateVideo(request: unknown): Promise<VideoGenerationResult> {
  const validated = VideoGenerationRequestSchema.parse(request); // throws if invalid

  const result = await this._generateVideo(validated);

  return VideoGenerationResultSchema.parse(result); // ensures output is valid
}
```

#### 5.4: Add Proper Error Handling

Your current error handling is scattered:

- Some workflows throw generic errors
- Some log to console
- Some return error objects
- Some fail silently

**Standardize:**

```typescript
// src/errors/WorkflowErrors.ts
export class WorkflowError extends Error {
  constructor(
    public code: string,
    public message: string,
    public retryable: boolean,
    public context?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export class StepFailureError extends WorkflowError {
  constructor(stepId: string, cause: Error) {
    super(
      'STEP_FAILURE',
      `Step ${stepId} failed: ${cause.message}`,
      true, // retryable
      { stepId, cause: cause.message },
    );
  }
}

export class ValidationError extends WorkflowError {
  constructor(rule: string, details: string) {
    super(
      'VALIDATION_FAILURE',
      `Validation failed: ${rule} - ${details}`,
      false, // not retryable
      { rule, details },
    );
  }
}

export class UniquenesssViolationError extends WorkflowError {
  constructor(field: string, duplicates: string[]) {
    super(
      'UNIQUENESS_VIOLATION',
      `Duplicate values found in ${field}`,
      true, // retryable (maybe with different generation)
      { field, duplicates },
    );
  }
}
```

**Handle systematically:**

```typescript
try {
  const result = await this.executeStep(step);
} catch (error) {
  if (error instanceof WorkflowError) {
    if (error.retryable && attempts < maxRetries) {
      // Retry with backoff
      await sleep(backoffDelay(attempts));
      return this.executeStepWithRetry(step, attempts + 1);
    }

    // Log structured error
    logger.error('Step execution failed', {
      errorCode: error.code,
      stepId: step.id,
      context: error.context,
    });

    throw error;
  }

  // Unexpected error
  throw new WorkflowError('UNKNOWN_ERROR', error.message, false);
}
```

---

## Part 4: Migration Path

### Phase 1: Add HITL Gates (Week 1-2)

**Goal:** Implement human-in-the-loop approval system without disrupting current workflows.

**Tasks:**

1. ✅ Create HITL database schema (`workflow_runs`, `hitl_approvals`)
2. ✅ Implement `HITLService` for approval management
3. ✅ Add HITL API routes (`/api/hitl/pending`, `/api/hitl/approve`, etc.)
4. ✅ Update n8n workflows to include HITL wait nodes
5. ✅ Build simple HITL approval UI
6. ✅ Test with one stage (idea generation)
7. ✅ Roll out to remaining stages

### Phase 2: Move Workflow Logic to RAG (Week 3-4)

**Goal:** Extract hard-coded orchestration logic into RAG (procedural memory).

**Tasks:**

1. ✅ Create workflow definition schema (`WorkflowDefinition` interface)
2. ✅ Convert existing Mylo_MCP_Bot system prompts to JSON workflow definitions
3. ✅ Store workflow definitions in `prompts/workflows/`
4. ✅ Ingest workflow definitions into RAG
5. ✅ Update MCP agent system prompts to load workflows from RAG
6. ✅ Test workflow execution with RAG-loaded logic
7. ✅ Remove hard-coded logic from n8n workflows

### Phase 3: Generalize Beyond AISMR (Week 5-6)

**Goal:** Make system project-agnostic by parameterizing project-specific logic.

**Tasks:**

1. ✅ Create workflow definitions for other video types (YouTube Shorts, Podcast Clips, etc.)
2. ✅ Extract project-specific configs (veo-3-fast settings, Shotstack templates) to RAG
3. ✅ Update workflows to load project configs dynamically
4. ✅ Test with second project to validate generalization
5. ✅ Document how to add new projects

---

## Summary: The Corrected North Star

### What You've Built (Excellent Foundation)

✅ **Advanced RAG System**
- Hybrid search (vector + BM25)
- Memory components (persona, project, semantic, episodic, procedural)
- Graph expansion for semantic discovery
- Temporal weighting for recency
- Adaptive retrieval for iterative refinement
- Clean MCP server architecture

✅ **4-Stage Pipeline Architecture**
- Separate workflows for quality gates
- n8n for UI and integrations
- MCP agents for intelligence

### What Needs to Change

❌ **Don't:** Consolidate into 1 workflow  
✅ **Do:** Keep 4 stages with HITL gates

❌ **Don't:** Build TypeScript orchestrator to replace n8n  
✅ **Do:** Make n8n agents smarter with RAG-stored logic

❌ **Don't:** Hard-code workflow logic in n8n JSON  
✅ **Do:** Store workflow definitions in RAG (procedural memory)

### The Complete Vision

```
4-Stage n8n Pipeline with HITL + RAG-Driven Intelligence

Stage 1: Generate Ideas (n8n workflow)
↓ → MCP Agent loads workflow from RAG
↓ → Executes using advanced RAG (memory routing, graph expansion, adaptive search)
↓ → Generates 12 unique ideas
↓ [HITL Gate: Human selects idea]

Stage 2: Write Script (n8n workflow)
↓ → MCP Agent loads workflow from RAG
↓ → Validates against AISMR specs (8s, 3.0s whisper, no music)
↓ → Generates screenplay
↓ [HITL Gate: Human approves script]

Stage 3: Make Videos (n8n workflow)
↓ → Uses n8n integrations (veo-3-fast, Shotstack)
↓ → Generates and edits video
↓ [HITL Gate: Human QA's video]

Stage 4: Post Video (n8n workflow)
↓ → Uses n8n integrations (TikTok, YouTube, Instagram)
↓ → Publishes to all platforms
✓ Done!
```

### Key Principles

1. **n8n for orchestration mechanics** (workflow engine, integrations, UI)
2. **RAG for intelligence** (workflow definitions, context, knowledge)
3. **MCP agents for execution** (dynamic, autonomous, adaptive)
4. **HITL for quality control** (human review, feedback loops)
5. **Separation for testability** (4 stages = 4 quality gates)

### To Generalize to New Projects

```bash
# 1. Add project config to RAG
cp prompts/project-aismr.json prompts/project-youtube-shorts.json
# Edit specs (duration, format, platform, etc.)

# 2. Add workflow definitions to RAG
cp prompts/workflows/aismr-*.json prompts/workflows/youtube-shorts-*.json
# Edit workflow steps, validations, etc.

# 3. Ingest to RAG
npm run ingest:prompts

# 4. Done! Use same n8n workflows with new project
POST /webhook/generate-video
{
  "project": "youtube-shorts",
  "userInput": "top 5 productivity hacks"
}
```

**No code changes required. Just prompts.**

---

**Built:** November 1, 2025  
**Reviewer:** AI Assistant  
**Status:** ✅ Aligned with vision: 4-stage pipeline + HITL + RAG-driven intelligence
