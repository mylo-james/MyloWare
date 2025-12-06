# ADR-0003: Config-Driven Agent Architecture

**Status**: Accepted
**Date**: 2025-12-06
**Authors**: MyloWare Team

## Context

Multi-agent systems require defining agent behaviors, tools, and constraints. Common approaches:

1. **Hardcoded**: Define agents in Python code
2. **Config-driven**: Define agents in YAML/JSON files
3. **Dynamic**: Generate agent configs at runtime

MyloWare needs to support multiple projects (AISMR, test_video_gen) with different agent configurations while sharing common patterns.

## Decision

We use a **YAML-based configuration system with inheritance**:

```
data/
├── shared/
│   └── agents/
│       ├── ideator.yaml      # Base ideator config
│       ├── producer.yaml     # Base producer config
│       └── editor.yaml       # Base editor config
└── projects/
    └── aismr/
        └── agents/
            └── ideator.yaml  # Project-specific override
```

Loading order:
1. Load base config from `data/shared/agents/{role}.yaml`
2. Deep merge with project config from `data/projects/{project}/agents/{role}.yaml`
3. Project config overrides base config

Example agent config:

```yaml
# data/shared/agents/ideator.yaml
role: ideator
model: meta-llama/Llama-3.2-3B-Instruct
tools:
  - builtin::websearch
  - builtin::rag/knowledge_search
shields:
  input: [llama_guard]
  output: [llama_guard]

# data/projects/aismr/agents/ideator.yaml (override)
instructions: |
  You are a creative ideator for ASMR video production.
  Generate ideas that are calming, visually appealing...
```

## Consequences

### Positive

- **Separation of Concerns**: Agent behavior (instructions) separated from infrastructure (tools, shields)
- **Reusability**: Base configs shared across projects
- **No Code Changes**: New projects don't require Python changes
- **Version Control**: Agent configs tracked in git
- **Override Flexibility**: Projects can override any aspect

### Negative

- **Indirection**: Need to look at multiple files to understand full config
- **Merge Complexity**: Deep merge logic can be surprising
- **Validation**: No compile-time checking of YAML validity

### Neutral

- Learning curve is minimal for developers familiar with YAML
- Config loading adds ~10ms to agent creation (acceptable)

## Alternatives Considered

### Alternative 1: Pure Python Config

**Rejected because**:
- Changes require code deployment
- Harder to share base patterns
- No clear separation of persona from infrastructure

### Alternative 2: Database-Stored Configs

**Rejected because**:
- Overkill for current use case
- Harder to version control
- Requires migration system

## Implementation Details

```python
# src/config/loaders.py
def load_agent_config(project: str, role: str) -> dict:
    """Load agent config with inheritance."""
    base = load_yaml(f"data/shared/agents/{role}.yaml")
    project_config = load_yaml(f"data/projects/{project}/agents/{role}.yaml")
    return deep_merge(base, project_config)
```

## References

- [Twelve-Factor App: Config](https://12factor.net/config)
- [YAML Best Practices](https://yaml.org/spec/1.2.2/)

