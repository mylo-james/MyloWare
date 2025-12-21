# Add a Tool

Create a custom Llama Stack tool.

---

## Create the Tool Class

Create `src/myloware/tools/your_tool.py`:

```python
from myloware.tools.base import MylowareBaseTool, JSONSchema


class YourTool(MylowareBaseTool):
    """Description for the LLM."""

    def get_name(self) -> str:
        return "your_tool"

    def get_description(self) -> str:
        return "What this tool does (shown to the LLM)"

    def get_input_schema(self) -> JSONSchema:
        return {
            "type": "object",
            "properties": {
                "param1": {
                    "type": "string",
                    "description": "What this parameter is for",
                },
                "param2": {
                    "type": "integer",
                    "default": 10,
                },
            },
            "required": ["param1"],
        }

    async def run_impl(self, param1: str, param2: int = 10) -> dict:
        # Your implementation
        result = await self._call_external_api(param1, param2)
        return {"status": "success", "data": result}
```

---

## Register with an Agent

Add to the agent's YAML config:

```yaml
tools:
  - your_tool
```

Or pass directly in code:

```python
from myloware.agents.factory import create_agent

agent = create_agent(
    client=client,
    project="my_project",
    role="producer",
    custom_tools=[YourTool()],
)
```

---

## Handle Async Operations

For tools that trigger webhooks (like video generation):

```python
async def run_impl(self, **kwargs) -> dict:
    # Start async job
    job_id = await self._start_job(kwargs)

    # Return immediately; webhook will resume workflow
    return {
        "status": "pending",
        "job_id": job_id,
        "message": "Job started, awaiting webhook callback",
    }
```

---

## Test

```python
# tests/unit/test_your_tool.py
import pytest
from myloware.tools.your_tool import YourTool


@pytest.fixture
def tool():
    return YourTool()


async def test_tool_returns_expected_format(tool):
    result = await tool.run_impl(param1="test")
    assert "status" in result
```
