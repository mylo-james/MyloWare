# Implementation Plans Index

## Active Plans

### 1. plan-prompts.md
**Status**: ✅ COMPLETED (Phase 1-6)  
**Topic**: Prompt system standardization and agentic RAG self-discovery  
**Key Changes**:
- Cleaned up prompt directory structure
- Implemented minimal system messages
- Enhanced tool descriptions for self-discovery
- Database reseeding with canonical prompts

### 2. plan-hitl.md
**Status**: 📋 SAVED FOR LATER  
**Topic**: AI-powered HITL system with Telegram integration  
**Key Features**:
- Riley (HITL coordinator agent)
- Dual-mode workflow (request + response)
- n8n Wait node webhooks for pause/resume
- Telegram inline keyboards + AI interpretation
- Reusable 5-node pattern for any workflow

**When to Implement**: After idea generator and screenwriter are working well

---

## Implementation Order Recommendation

1. ✅ **Prompts System** (DONE)
2. ✅ **Idea Generator Simplification** (DONE) - 2-word surreal modifier + object pattern
3. ✅ **video_query Tool** (DONE) - Global uniqueness checking
4. ✅ **Schema Management System** (DONE) - Push/pull with n8n workflows
5. 🔜 **Test Current System** - Validate idea generation and screenplay workflows work end-to-end
6. 📋 **HITL System** (plan-hitl.md) - After core workflows validated

---

## Recent Accomplishments

**Today (2025-11-03)**:
- Standardized all prompts (removed v2 versions)
- Implemented agentic RAG self-discovery
- Simplified idea generator (surreal modifier + object)
- Created video_query MCP tool
- Built schema push/pull system
- Fixed projectId slug support

**Next Session**:
- Test idea generation workflow end-to-end
- Test screenwriter workflow
- Then implement HITL system if needed
