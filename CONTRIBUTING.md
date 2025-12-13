# Contributing to MyloWare

Thank you for your interest in contributing to MyloWare! This document provides guidelines and information for contributors.

## Code of Conduct

Be respectful, inclusive, and constructive. We're all here to build great software together.

## Development Setup

1. Fork and clone the repository
2. Create a virtual environment: `python -m venv .venv`
3. Activate it: `source .venv/bin/activate`
4. Install dev dependencies: `pip install -e ".[dev]"`
5. Copy environment: `cp .env.example .env`

See [docs/QUICKSTART.md](docs/QUICKSTART.md) for detailed setup instructions.

## Development Workflow

### 1. Create a Branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/issue-description
```

### 2. Make Your Changes

- Follow existing code style
- Add tests for new functionality
- Update documentation if needed

### 3. Run Tests

```bash
# Unit tests (required to pass)
PYTHONPATH=src pytest tests/unit/ -v

# Linting (required to pass)
ruff check src/ tests/
black --check src/ tests/
```

### 4. Commit

Write clear commit messages:

```bash
git commit -m "feat(agents): add memory bank support for supervisor"
git commit -m "fix(orchestrator): handle missing artifacts gracefully"
git commit -m "docs: update Llama Stack configuration guide"
```

### 5. Push and Create PR

```bash
git push origin feature/your-feature-name
```

Then open a Pull Request on GitHub.

## Code Style

### Python

- **Formatter**: Black (line length 100)
- **Linter**: Ruff
- **Type hints**: Required for public functions

```python
def create_agent(
    client: LlamaStackClient,
    project: str,
    role: str,
    vector_db_id: str | None = None,
) -> Agent:
    """Create a Llama Stack agent from project config.
    
    Args:
        client: Llama Stack client
        project: Project name (e.g., "aismr")
        role: Agent role (ideator, producer, etc.)
        vector_db_id: Optional vector DB for RAG
        
    Returns:
        Configured Llama Stack Agent
    """
    ...
```

### YAML Configuration

- Use 2-space indentation
- Include comments for non-obvious settings
- Follow existing patterns in `data/shared/agents/`

```yaml
role: ideator
description: Creative ideator for video production

model: meta-llama/Llama-3.2-3B-Instruct

instructions: |
  You are the Ideator...

tools:
  - builtin::websearch
  - builtin::rag/knowledge_search
```

## Testing

### Test Categories

1. **Unit Tests** (`tests/unit/`)
   - Fast, no external dependencies
   - All APIs mocked
   - Run before every commit

2. **Integration Tests** (`tests/integration/`)
   - Test real Llama Stack interactions
   - Use `@pytest.mark.integration`
   - Require Llama Stack server running

### Writing Tests

```python
def test_create_agent_loads_config(monkeypatch):
    """Agent factory should load config from YAML files."""
    
    # Mock the client
    fake_client = Mock()
    
    # Mock config loading
    monkeypatch.setattr(
        "agents.factory.load_agent_config",
        lambda p, r: {"role": r, "instructions": "test"}
    )
    
    # Test
    agent = create_agent(fake_client, "test", "ideator")
    
    # Assert
    assert agent is not None
```

### Running Tests

```bash
# All unit tests
PYTHONPATH=src pytest tests/unit/ -v

# Specific file
PYTHONPATH=src pytest tests/unit/test_orchestrator.py -v

# With coverage
PYTHONPATH=src pytest tests/unit/ --cov=src --cov-report=html

# Integration tests (requires Llama Stack)
PYTHONPATH=src pytest tests/integration/ -v -m integration
```

## Architecture Guidelines

### Llama Stack Native

MyloWare is 100% Llama Stack native. When adding features:

- ✅ Use Llama Stack APIs directly
- ✅ Leverage built-in tools (`builtin::websearch`, `builtin::rag/*`)
- ✅ Use Llama Stack telemetry for observability
- ❌ Don't add LangChain, LangGraph, or similar frameworks
- ❌ Don't create abstractions that hide Llama Stack

### Config-Driven

Agent behavior should be configurable via YAML:

```yaml
# data/shared/agents/my_agent.yaml
role: my_agent
instructions: |
  Base instructions...

# data/projects/myproject/agents/my_agent.yaml  
instructions: |
  Project-specific override...
```

### Fail-Fast

No silent failures or fallbacks:

```python
# ❌ Wrong
def get_config(key: str) -> str:
    return os.environ.get(key, "default")

# ✅ Right
def get_config(key: str) -> str:
    value = os.environ.get(key)
    if value is None:
        raise ValueError(f"Required config {key} not set")
    return value
```

## CI Pipeline

### Jobs

The CI pipeline runs the following jobs in order:

1. **Lint** - Code style (ruff, black, mypy)
2. **Test** - Unit tests with coverage
3. **Eval** - Evaluation pipeline validation
4. **Build** - Docker image build

### Skipping Eval in CI

For documentation-only changes or commits that don't affect output quality, you can skip the eval gate by including `[skip eval]` or `[skip-eval]` in your commit message:

```bash
git commit -m "docs: update README [skip eval]"
git commit -m "chore: update dependencies [skip-eval]"
```

**When to use:**
- Documentation-only changes
- Dependency updates
- CI/CD configuration changes
- Code style/formatting changes

**When NOT to use:**
- Changes to agents, prompts, or workflows
- Changes to evaluation logic
- Any change that could affect output quality

### Running Eval Locally

```bash
# Dry-run (validates dataset loads)
make eval-dry

# Full eval (requires Llama Stack)
make eval

# Custom threshold
EVAL_THRESHOLD=4.0 make eval
```

## Pull Request Guidelines

### Before Submitting

- [ ] Tests pass locally
- [ ] Linting passes
- [ ] Eval dry-run passes (`make eval-dry`)
- [ ] Documentation updated (if needed)
- [ ] Commit messages are clear

### PR Description Template

```markdown
## Description
Brief description of changes.

## Type
- [ ] Feature
- [ ] Bug fix
- [ ] Documentation
- [ ] Refactor

## Testing
How was this tested?

## Related Issues
Fixes #123
```

### Review Process

1. Automated checks must pass (CI)
2. At least one maintainer review
3. No unresolved conversations
4. Squash merge to main

## Adding New Features

### New Agent Role

1. Create base config: `data/shared/agents/your_role.yaml`
2. Add to workflow if needed: `data/projects/*/workflow.yaml`
3. Add tests: `tests/unit/test_your_role.py`
4. Update docs if public-facing

### New Custom Tool

1. Extend `MylowareBaseTool` in `src/tools/`
2. Register in agent configs that need it
3. Add tests with mocked API calls
4. Document in README

### New API Endpoint

1. Add route in `src/api/routes/`
2. Include in router: `src/api/routes/__init__.py`
3. Add authentication if needed
4. Add tests
5. Document endpoint

## Questions?

- Open a GitHub issue for bugs or feature requests
- Check existing issues before creating new ones
- Tag issues appropriately (`bug`, `enhancement`, `documentation`)

Thank you for contributing! 🦙

