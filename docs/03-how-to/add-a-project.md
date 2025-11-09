# How to Add a Project

**Audience:** Developers adding new production types  
**Outcome:** New project type available in MyloWare  
**Time:** 1-2 hours

---

## Overview

Projects define production types (AISMR, GenReact, etc.). Each project specifies:
- Agent workflow order
- Production specs (video count, duration, etc.)
- Quality guardrails
- Optional steps

---

## Prerequisites

- [Local setup complete](../01-getting-started/local-setup.md)
- Understanding of [System Overview](../02-architecture/system-overview.md)
- Personas already exist for your workflow

---

## Steps

### 1. Create Project Configuration

Create `data/projects/your-project.json`:

```json
{
  "slug": "product-review",
  "name": "Product Review Videos",
  "description": "Multi-angle product review videos with commentary",
  "workflow": [
    "casey",
    "iggy",
    "riley",
    "veo",
    "alex",
    "quinn"
  ],
  "optionalSteps": ["alex"],
  "specs": {
    "videoCount": 5,
    "videoDuration": 15.0,
    "angles": ["front", "side", "top", "detail", "action"],
    "compilationLength": 90,
    "format": "angle_labels"
  },
  "guardrails": {
    "tone": "informative_enthusiastic",
    "accuracy": "factual_no_exaggeration",
    "style": "professional_engaging"
  },
  "metadata": {
    "version": "1.0.0",
    "author": "MyloWare Team",
    "platforms": ["youtube", "tiktok"]
  }
}
```

**Key fields:**
- `slug` - Unique identifier (lowercase, hyphenated)
- `workflow` - Agent pipeline order
- `optionalSteps` - Agents that can be skipped
- `specs` - Production requirements
- `guardrails` - Quality constraints

### 2. Seed Project to Database

```bash
npm run migrate:projects
```

This reads `data/projects/*.json` and upserts to database.

### 3. Verify Project

```bash
psql $DATABASE_URL -c "
  SELECT id, slug, name, workflow 
  FROM projects 
  WHERE slug = 'product-review'
"
```

### 4. Test Project Detection

Create test trace:

```bash
curl -X POST http://localhost:3456/tools/trace_create \
  -H "Content-Type: application/json" \
  -H "X-API-Key: mylo-mcp-bot" \
  -d '{
    "projectId": "product-review",
    "sessionId": "test:project"
  }'
```

### 5. Test Casey Detection

Send message to Telegram bot:

```
Make a product review video for wireless headphones
```

Casey should:
1. Detect "product review" keyword
2. Set `projectId` to your project UUID
3. Hand off to first agent in workflow

---

## Validation

✅ Project JSON exists in `data/projects/`  
✅ Project seeded to database  
✅ Casey detects project from user messages  
✅ Workflow progresses through all agents  
✅ Optional steps can be skipped

---

## Project Specs Guidelines

### Video Count
Typical values:
- AISMR: 12 (surreal modifiers)
- GenReact: 6 (generations)
- Product Review: 5 (angles)

### Video Duration
- Short-form: 8.0s (TikTok/Reels)
- Medium-form: 15.0s (YouTube Shorts)
- Long-form: 30.0s+ (YouTube)

### Compilation Length
- Formula: `videoCount * videoDuration + transitions`
- AISMR: 12 * 8.0 + 14 = 110s
- GenReact: 6 * 8.0 + 6 = 54s

---

## Guardrails Guidelines

### Tone
- `humorous_respectful` - Light comedy
- `informative_enthusiastic` - Educational
- `surreal_impossible` - AISMR style
- `professional_engaging` - Product reviews

### Accuracy
- `culturally_accurate` - GenReact
- `factual_no_exaggeration` - Product reviews
- `creative_freedom` - AISMR

### Style
- `surreal_impossible_modifiers` - AISMR
- `light_observational_comedy` - GenReact
- `professional_engaging` - Product reviews

---

## Optional Steps

Mark agents as optional when:
- Editing can be skipped for simple requests
- Sound design is optional enhancement
- Certain angles can be omitted

Example:
```json
{
  "workflow": ["casey", "iggy", "riley", "veo", "morgan", "alex", "quinn"],
  "optionalSteps": ["morgan", "alex"]
}
```

Agents can skip optional steps by handing off directly to the next required agent.

---

## Next Steps

- [Add a Persona](add-a-persona.md) - Create custom agents
- [Run Integration Tests](run-integration-tests.md) - Test your project
- [System Overview](../02-architecture/system-overview.md) - Architecture details

---

## Troubleshooting

**Casey not detecting project?**
- Add keywords to project description
- Test with explicit project name in message
- Check Casey's project detection logic

**Workflow skipping agents?**
- Verify workflow array order
- Check all personas exist in database
- Verify handoff instructions reference correct agent

**Specs not enforced?**
- Check Riley validates against project specs
- Verify guardrails are actionable
- Add validation to persona prompts

See [Troubleshooting Guide](../05-operations/troubleshooting.md) for more help.

