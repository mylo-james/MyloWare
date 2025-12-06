# Creating Custom Tools

MyloWare tools extend `ClientTool` from Llama Stack, wrapped as `MylowareBaseTool` which provides:
- Standardized error handling
- JSON response formatting
- Observability integration

## Llama Stack Native Pattern

Tools follow Llama Stack's `ClientTool` pattern from `llama_stack_client.lib.agents.client_tool`.

## Steps to Create a New Tool

1. Create a new file in `src/tools/`
2. Extend `MylowareBaseTool`
3. Implement required methods:
   - `get_name()` → str
   - `get_description()` → str
   - `get_params_definition()` → Dict[str, Parameter]
   - `run_impl(**kwargs)` → Dict[str, Any]
4. Add the tool to `src/tools/__init__.py` exports.

## Example

```python
from tools.base import MylowareBaseTool, Parameter, format_tool_success


class MyNewTool(MylowareBaseTool):
    def __init__(self, api_key: str):
        self.api_key = api_key

    def get_name(self) -> str:
        return "my_new_tool"

    def get_description(self) -> str:
        return "Description of what this tool does"

    def get_params_definition(self) -> dict:
        return {
            "param1": Parameter(
                param_type="str",
                description="First parameter",
                required=True,
            ),
            "count": Parameter(
                param_type="int",
                description="Number of items",
                required=False,
            ),
        }

    async def run_impl(self, param1: str, count: int = 10) -> dict:
        # Call external API
        result = {"param1": param1, "count": count}
        return format_tool_success(result, "Operation completed")
```

## Parameter Types

Use these `param_type` values (Llama Stack native):
- `"str"` - String values
- `"int"` - Integer values
- `"list"` - Array/list values
- `"object"` - Complex object/dict values
- `"bool"` - Boolean values

## Adding Fake Provider Support

For testing without real API calls, add a `use_fake` parameter:

```python
def __init__(self, use_fake: bool | None = None):
    if use_fake is None:
        self.use_fake = getattr(settings, "use_fake_providers", False)
    else:
        self.use_fake = use_fake

async def run_impl(self, **kwargs):
    if self.use_fake:
        return self._fake_response()
    return await self._real_api_call(**kwargs)
```
