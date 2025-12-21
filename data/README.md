# MyloWare Data Directory

This directory contains knowledge content and project configurations.

## Structure

```
data/
├── knowledge/           # Domain knowledge → ingested into Vector I/O (RAG)
│   ├── index.md        # Knowledge base index
│   ├── remotion-*.md   # Remotion video rendering documentation
│   ├── sora-*.md       # OpenAI Sora video generation docs
│   └── ...             # Other domain knowledge
│
├── shared/
│   └── agents/         # Base agent YAML configs (job descriptions)
│       ├── ideator.yaml
│       ├── producer.yaml
│       ├── editor.yaml
│       ├── publisher.yaml
│       └── supervisor.yaml
│
└── projects/           # Project-specific configurations
    ├── aismr/
    │   ├── agents/     # Project-specific agent overrides
    │   ├── knowledge/  # Project-specific knowledge
    │   └── guardrails/ # Content guardrails
    └── motivational/
        ├── agents/
        ├── knowledge/
        └── guardrails/
```

## Llama Stack Integration

- **Knowledge docs**: Ingested via `knowledge.setup.setup_knowledge_base()`
- **Accessed via**: `builtin::rag/knowledge_search` tool in agents
- **Agent configs**: Loaded via `config.loaders.load_agent_config()`
