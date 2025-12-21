# Agent Configuration

YAML schema for agent definitions.

---

## File Locations

```
data/
├── shared/agents/       # Base configs (all projects)
│   ├── ideator.yaml
│   ├── producer.yaml
│   ├── editor.yaml
│   └── publisher.yaml
│
└── projects/{project}/agents/  # Project overrides
    └── ideator.yaml
```

---

## Schema

```yaml
# Required
role: string           # Agent role identifier
instructions: string   # System prompt (supports multi-line)

# Optional
description: string    # Human-readable description
model: string          # Model ID (default: from settings)

tools:                 # List of tools
  - builtin::websearch
  - builtin::rag/knowledge_search
  - custom_tool_name

sampling_params:       # Generation parameters
  strategy:
    type: greedy       # or "top_p", "top_k"
  temperature: 0.7     # Only for non-greedy
  max_tokens: 2048
```

---

## Built-in Tools

| Tool | Description |
|------|-------------|
| `builtin::websearch` | Web search via Brave |
| `builtin::rag/knowledge_search` | Query vector database |
| `builtin::memory/query` | Query memory banks |

---

## Config Inheritance

Project configs merge with base configs:

```yaml
# data/shared/agents/ideator.yaml (base)
role: ideator
instructions: |
  You generate video ideas.
tools:
  - builtin::websearch

# data/projects/aismr/agents/ideator.yaml (override)
instructions: |
  You generate ASMR video ideas.
  Focus on relaxation and triggers.
```

**Result**: Project instructions replace base, tools are inherited.

---

## Example: Ideator

```yaml
role: ideator
description: Generates creative video concepts

model: meta-llama/Llama-3.2-3B-Instruct

instructions: |
  You are the Ideator for video production.

  ## Your Job
  Generate 3 unique video ideas based on the brief.

  ## Tools
  - Use websearch for trending topics
  - Use knowledge_search for project context

  ## Output Format
  For each idea:
  1. **Title**: Catchy, specific
  2. **Hook**: First 3 seconds
  3. **Description**: 2-3 sentences

tools:
  - builtin::websearch
  - builtin::rag/knowledge_search

sampling_params:
  strategy:
    type: greedy
```

---

## Example: Producer

```yaml
role: producer
description: Creates video generation prompts

instructions: |
  You are the Producer.

  ## Your Job
  Convert approved ideas into video prompts.

  ## Output Format
  For each clip:
  - visual_prompt: Detailed scene description
  - voice_over: Optional narration
  - duration: Seconds (5-15)

tools:
  - sora_generate
  - builtin::rag/knowledge_search

sampling_params:
  strategy:
    type: greedy
```
