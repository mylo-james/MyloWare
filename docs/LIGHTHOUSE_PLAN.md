# MyloWare Lighthouse Plan

**Goal**: Transform this repo into a portfolio-quality "lighthouse" project that demonstrates senior-level engineering practices with Llama Stack.

**Perspective**: What would a Senior Engineer or Executive Director of AI expect from this repo when evaluating a candidate?

---

## Executive Summary

### Current State: Good Foundation
- ✅ Clean Llama Stack integration using `llama_stack_client.lib.agents.agent.Agent`
- ✅ Config-driven agent definitions (YAML with inheritance)
- ✅ Custom tools extending `ClientTool` pattern
- ✅ 170+ unit tests with 80% coverage requirement
- ✅ CI/CD pipeline (lint, test, build, deploy)
- ✅ Observability with Langfuse integration
- ✅ Docker + docker-compose for local dev

### Gaps: Needs Work
- ⚠️ Tool implementation pattern slightly outdated vs latest Llama Stack docs
- ⚠️ SOLID violations (915-line orchestrator, mixed responsibilities)
- ⚠️ Missing developer experience tooling (Makefile, pre-commit)
- ⚠️ No example notebooks for users
- ⚠️ Documentation gaps (API reference, ADRs)

---

## Part 1: Llama Stack Alignment

### 1.1 Update CustomTool Pattern

**Current**: Uses `get_input_schema()` returning JSON Schema dict
```python
class MylowareBaseTool(ClientTool):
    def get_input_schema(self) -> JSONSchema:
        return {"type": "object", "properties": {...}}
```

**Llama Stack Current**: Uses `get_params_definition()` with `ToolParamDefinitionParam`
```python
from llama_stack_client.lib.agents.custom_tool import CustomTool
from llama_stack_client.types.tool_param_definition_param import ToolParamDefinitionParam

class MyTool(CustomTool):
    def get_params_definition(self) -> Dict[str, ToolParamDefinitionParam]:
        return {
            "location": ToolParamDefinitionParam(
                param_type="str",
                description="City or location name",
                required=True
            ),
        }
```

**Action Items**:
- [ ] Refactor `MylowareBaseTool` to extend `CustomTool` instead of `ClientTool`
- [ ] Update all tools (KIE, Remotion, Upload-Post) to use `ToolParamDefinitionParam`
- [ ] Add `async def run_impl()` for async I/O operations (optional but preferred)

### 1.2 Vector Store API Updates

**Current**: Uses `builtin::rag/knowledge_search` string
**Llama Stack Current**: Uses `file_search` type with `vector_store_ids`

```python
# Current pattern (good!)
tools = [{"type": "file_search", "vector_store_ids": [vector_store.id]}]
```

**Action Items**:
- [ ] Update knowledge setup to use `client.vector_stores.create()` API
- [ ] Consider chunking strategy configuration
- [ ] Add file upload via `client.files.create()` for better document handling

### 1.3 Agent Creation Best Practices

**Current**: Correct usage of `Agent` class
**Enhancement**: Add sampling_params explicitly

```python
agent = Agent(
    client=client,
    model=model,
    instructions=instructions,
    tools=tools,
    sampling_params={"strategy": {"type": "greedy"}},  # Add explicitly
)
```

---

## Part 2: SOLID Principles Refactoring

### 2.1 Single Responsibility Principle

**Problem**: `orchestrator.py` is 915 lines handling:
- Workflow state management
- Agent creation
- Step execution (ideation, production, editing, publishing)
- Telegram notifications
- Video caching
- JSON parsing

**Solution**: Split into focused modules

```
src/workflows/
├── __init__.py
├── state.py          # WorkflowState, status transitions
├── steps/
│   ├── __init__.py
│   ├── base.py       # Abstract WorkflowStep
│   ├── ideation.py   # IdeationStep
│   ├── production.py # ProductionStep
│   ├── editing.py    # EditingStep
│   └── publishing.py # PublishingStep
├── orchestrator.py   # Thin coordinator (< 200 lines)
└── notifications.py  # Notification handling
```

**Action Items**:
- [ ] Extract `WorkflowState` class with explicit state machine
- [ ] Create abstract `WorkflowStep` base class
- [ ] Extract each step into focused classes
- [ ] Create step registry for dynamic step loading

### 2.2 Open/Closed Principle

**Problem**: Adding new workflow steps requires modifying orchestrator
**Solution**: Plugin architecture for steps

```python
# data/projects/{project}/workflow.yaml
steps:
  - name: ideation
    handler: steps.ideation.IdeationStep
    config:
      hitl_gate: post_ideation
  - name: production
    handler: steps.production.ProductionStep
```

### 2.3 Dependency Inversion

**Problem**: Direct imports of concrete implementations
**Solution**: Protocol-based interfaces

```python
# src/workflows/protocols.py
from typing import Protocol

class AgentFactory(Protocol):
    def create(self, project: str, role: str, **kwargs) -> Agent: ...

class NotificationService(Protocol):
    async def send(self, run_id: UUID, event: str, data: dict) -> None: ...
```

---

## Part 3: Portfolio Quality Requirements

### 3.1 Developer Experience

**Missing**:
- Makefile for common commands
- Pre-commit hooks
- Dev container configuration

**Action Items**:
- [ ] Create `Makefile` with targets: `install`, `test`, `lint`, `format`, `docker-up`, `docker-down`
- [ ] Add `.pre-commit-config.yaml` with ruff, black, mypy hooks
- [ ] Add `.devcontainer/` for VS Code Dev Containers

### 3.2 Documentation Gaps

**Missing**:
- Architecture Decision Records (ADRs)
- API reference (auto-generated)
- Example notebooks
- Runbook for operations

**Action Items**:
- [ ] Create `docs/decisions/` with ADR template
- [ ] Add ADRs for: Llama Stack choice, Remotion over Shotstack, YAML config design
- [ ] Generate OpenAPI spec export (`/openapi.json` endpoint)
- [ ] Create `notebooks/` with getting started examples
- [ ] Add `docs/RUNBOOK.md` for production operations

### 3.3 Testing Enhancements

**Current**: 170+ unit tests, 80% coverage
**Missing**:
- Contract tests for webhooks
- Property-based testing
- Integration test automation in CI

**Action Items**:
- [ ] Add `pytest-contracts` for webhook schemas
- [ ] Add `hypothesis` for property-based testing of parsers
- [ ] Enable integration tests in CI (with Llama Stack mock server)

### 3.4 Security & Compliance

**Current**: Basic API key auth, webhook signatures
**Missing**:
- Dependabot configuration
- Security policy
- Rate limiting configuration

**Action Items**:
- [ ] Add `.github/dependabot.yml` for dependency updates
- [ ] Add `SECURITY.md` with vulnerability reporting process
- [ ] Document rate limiting configuration in API

---

## Part 4: Code Quality Improvements

### 4.1 Type Safety

**Current**: Basic type hints, no mypy in CI
**Action Items**:
- [ ] Add mypy to CI workflow
- [ ] Create `py.typed` marker file
- [ ] Add type stubs for untyped dependencies

### 4.2 Constants & Enums

**Problem**: Magic strings throughout
```python
# Bad
if run.status == "awaiting_ideation_approval":

# Good
if run.status == RunStatus.AWAITING_IDEATION_APPROVAL:
```

**Action Items**:
- [ ] Audit for magic strings
- [ ] Use `RunStatus`, `ArtifactType` enums consistently
- [ ] Create `ToolName` enum for tool names

### 4.3 Error Handling

**Current**: Mixed patterns (exceptions, result types)
**Action Items**:
- [ ] Standardize on Result type for domain operations
- [ ] Create custom exception hierarchy
- [ ] Add structured error codes for API responses

---

## Part 5: Implementation Roadmap

### Phase 1: Quick Wins (1-2 days)
1. Add Makefile
2. Add pre-commit hooks
3. Fix remaining magic strings
4. Add mypy to CI
5. Create ADR template + first 2 ADRs

### Phase 2: Tool Alignment (2-3 days)
1. Refactor `MylowareBaseTool` to use `CustomTool`
2. Update all tools to `ToolParamDefinitionParam`
3. Update knowledge setup to new vector store API
4. Update tests

### Phase 3: SOLID Refactoring (3-5 days)
1. Extract `WorkflowState` class
2. Create `WorkflowStep` base class
3. Extract each step to separate module
4. Create step registry
5. Slim down orchestrator to < 200 lines
6. Update tests

### Phase 4: Documentation (2-3 days)
1. Create example notebooks
2. Add RUNBOOK.md
3. Generate OpenAPI spec
4. Add API versioning strategy doc

### Phase 5: Polish (1-2 days)
1. Add dev container
2. Add property-based tests
3. Add coverage badges to README
4. Final cleanup

---

## Success Criteria

A Senior Engineer reviewing this repo should see:

1. **Clean Architecture**: Clear separation of concerns, < 200 LOC per module
2. **Llama Stack Mastery**: Correct usage of latest APIs and patterns
3. **Production Ready**: CI/CD, observability, error handling, security
4. **Developer Friendly**: Makefile, pre-commit, dev containers, good docs
5. **Well Tested**: 80%+ coverage, multiple test types, CI automation
6. **Maintainable**: ADRs, clear naming, minimal magic strings

---

## Questions to Answer Before Implementing

1. **Async vs Sync Tools**: Should we migrate to fully async tool pattern? (Recommended: Yes for I/O tools)
2. **State Machine Library**: Use `transitions` library for workflow state? (Recommended: Yes)
3. **Result Types**: Use `result` library for domain operations? (Optional enhancement)
4. **Notebook Framework**: Use Jupyter or Marimo for examples? (Recommended: Jupyter for familiarity)

---

## References

- [Llama Stack Documentation](https://github.com/meta-llama/llama-stack)
- [Llama Stack Client Python](https://github.com/meta-llama/llama-stack-client-python)
- [SOLID Principles](https://en.wikipedia.org/wiki/SOLID)
- [ADR GitHub Organization](https://adr.github.io/)

