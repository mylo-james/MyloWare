# RAG Research Comparison

## Research Highlights
- Adaptive retrieval loops where the agent self-assesses whether additional knowledge is needed, issues follow-up searches, and halts retrieval once utility drops.
- Metadata-aware ranking that blends semantic similarity with filters for persona, project, user profile, and temporal state; retrieval namespaces are often partitioned per context.
- Episodic and long-term conversation memory (e.g., ReMem) that surfaces prior dialogue on demand instead of streaming the entire history.
- Core memory blocks that persist persona, project/task, and user preference data so the agent stays role-consistent across sessions.

## Current Implementation (Key Files)
- `src/server/tools/promptSearchTool.ts`: single-shot semantic search with optional persona/project filters, fixed similarity threshold, and top-k retrieval.
- `src/server/tools/promptGetTool.ts`: deterministic prompt lookup that normalises persona/project slugs and falls back from combined → persona-only → project-only prompts.
- `src/db/repository.ts`: vector search over a single embeddings table with JSONB metadata filters limited to persona/project/type.

## Comparison
- Adaptive retrieval: the workflow (`mylo-mcp-agent.workflow.json`) hard-codes three static searches; tools never reason about whether to search again or refine queries. This lacks the agent-driven iterative behaviour described in the research.
- Metadata blending: we normalise persona/project and filter via JSONB equality, but we do not weigh metadata in scoring or support richer facets (user identity, session, recency). Ranking is purely vector distance once a filter passes.
- History-aware memory: there is no mechanism for conversation recall or episodic memory—prompt searches target static prompt content only.
- Persona/project memory: metadata arrays capture personas/projects, yet they share a single namespace. We do not isolate persona/project embeddings, nor do we persist user preference blocks, so cross-project bleed-through remains possible.

## Opportunities
- Introduce an adaptive retrieval controller that can re-query, broaden, or cancel searches based on similarity/confidence (aligning with agentic RAG loops).
- Implement hybrid scoring (e.g., weighted combination of similarity and metadata matches) and broaden metadata schema to include user/session context.
- Add a dedicated conversational memory store (summaries + vector index) so the agent can fetch previous exchanges when relevant.
- Partition embeddings by memory type (persona, project, user, history) or move to multi-namespace vector collections to cleanly separate contexts.
