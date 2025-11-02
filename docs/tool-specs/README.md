# MCP Tool Specifications

This directory contains YAML specifications for all MCP (Model Context Protocol) tools available in the MyloWare system.

## Tools Overview

| Tool | Namespace | Pattern | Description |
|------|-----------|---------|-------------|
| [`conversation_latest`](./conversation_latest.yml) | memory | structured_data_retrieval | Get the most recent conversation turns for a session |
| [`conversation_remember`](./conversation_remember.yml) | memory | knowledge_base | Semantic search across episodic conversation memory |
| [`conversation_store`](./conversation_store.yml) | memory | external_api | Store a conversation turn in episodic memory |
| [`memory_add`](./memory_add.yml) | memory | external_api | Create a new runtime memory chunk |
| [`memory_update`](./memory_update.yml) | memory | external_api | Update an existing memory chunk |
| [`memory_delete`](./memory_delete.yml) | memory | external_api | Deactivate a memory chunk (soft delete) |
| [`prompt_get`](./prompt_get.yml) | prompts | structured_data_retrieval | Resolve and fetch a prompt document by persona/project |
| [`prompt_list`](./prompt_list.yml) | prompts | structured_data_retrieval | List available prompts with optional filters |
| [`prompt_search`](./prompt_search.yml) | prompts | knowledge_base | Semantic/keyword/hybrid search across prompt corpus |
| [`prompts_search_adaptive`](./prompts_search_adaptive.yml) | prompts | knowledge_base | Adaptive iterative prompt search with utility-based decisions |

## Specification Format

All tool specifications follow the schema defined in [`../tool-description.schema.json`](../tool-description.schema.json). Each spec includes:

- **Required fields**: `id`, `name`, `version`, `description`, `input_schema`, `output_schema`
- **Optional fields**: `one_liner`, `invocation_context`, `agent_hint`, `pattern`, `tags`, `availability`, `constraints`, `auth`, `metrics`, `versioning`, `examples`

## Validation

Run the validation script to check all specs:

```bash
npm run validate:tool-specs
# or
npx tsx scripts/validateToolSpecs.ts
```

## Adding a New Tool Spec

When adding a new MCP tool:

1. Create a new YAML file in this directory named `<tool_name>.yml`
2. Follow the schema in `tool-description.schema.json`
3. Use an existing spec as a template (e.g., `conversation_latest.yml`)
4. Set the `id` field as `myloware.<namespace>.<tool_name>.v1`
5. Ensure the `name` matches the MCP tool registration name
6. Run validation to check for errors
7. Update this README with the new tool

## Updating an Existing Spec

When modifying a tool:

1. Update the relevant YAML file
2. Increment the `version` field if making breaking changes
3. Update `versioning.last_updated` to the current date
4. Update any examples if behavior changed
5. Run validation to ensure the spec is still valid
6. Update this README if the tool description changed

## Related Documentation

- [Tool Description Schema](../tool-description.schema.json) - JSON Schema for tool specs
- [Tool Inventory](./INVENTORY.md) - Detailed inventory extracted from source code
- [Main Plan](../PLAN.md) - Overall project documentation

