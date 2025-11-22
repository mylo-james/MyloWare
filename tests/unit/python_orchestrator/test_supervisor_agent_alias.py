from __future__ import annotations

from apps.orchestrator import brendan_agent
from apps.orchestrator.supervisor import agent as supervisor_agent


def test_supervisor_agent_reexports_brendan_run_function() -> None:
    # The supervisor agent should be the canonical alias of Brendan's agent implementation.
    assert supervisor_agent.run_supervisor_agent is brendan_agent.run_brendan_agent

