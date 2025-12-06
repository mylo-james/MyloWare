"""MyloWare observability module - telemetry, tracing, and logging.

Provides Langfuse integration for LLM observability:
- Workflow traces
- Agent turn tracing
- Tool call tracing
- Cost and token tracking

Usage:
    from observability import trace_workflow, trace_agent_turn, observe

    @trace_workflow("video_production")
    def run_workflow(run_id: str, brief: str):
        ...

    @observe(as_type="generation")
    def ideator_turn(messages):
        ...
"""

from observability.langfuse_integration import (
    flush_traces,
    get_langfuse,
    observe,
    setup_langfuse,
    trace_agent_turn,
    trace_tool_call,
    trace_workflow,
)

__all__ = [
    "get_langfuse",
    "trace_workflow",
    "trace_agent_turn",
    "trace_tool_call",
    "observe",
    "setup_langfuse",
    "flush_traces",
]
