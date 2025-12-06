# MyloWare Knowledge Base

Domain knowledge and tool expertise for RAG ingestion.

---

## Tool References

| Document | Tool | Description |
|----------|------|-------------|
| remotion-api-docs.md | remotion_render | Remotion components, animation, rendering |
| remotion-vertical-video-guide.md | remotion_render | 9:16 vertical video specs |
| kie-video-generation.md | kie_generate | AI video prompts, best practices |
| upload-post-publishing.md | upload_post | Social media publishing |

---

## Domain Expertise

| Document | Topic | Relevant Agents |
|----------|-------|-----------------|
| landscape-video-styles.md | Cinematic landscape prompts | Producer, Ideator |
| editor-knowledge.md | Video editing principles | Editor |
| comedic-timing.md | Pacing and rhythm | Ideator, Producer |
| idea-gen.md | Ideation techniques | Ideator |
| screenwriter-knowledge.md | Story structure | Ideator |
| social-media.md | Platform best practices | Publisher |

**Project-scoped knowledge (not stored in shared KB):**
- `data/projects/aismr/knowledge/zodiac-signs.md`
- `data/projects/test_video_gen/knowledge/motivational-video-guide.md`

---

## How Agents Use Knowledge

1. **Query by topic**: `knowledge_search("Remotion API")` 
2. **Learn techniques**: Read examples and best practices
3. **Apply to task**: Use knowledge to complete project work

---

## Knowledge Architecture

```
Shared Agents (Job Descriptions)
    ↓ define roles & tools
Project Agents (Task Instructions)  
    ↓ specify what to do
Knowledge Base (Expertise)
    ↓ explains how to do it
```
