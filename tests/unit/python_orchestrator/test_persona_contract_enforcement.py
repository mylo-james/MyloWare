"""Tests for persona contract enforcement (fail-fast validation)."""
import pytest
from apps.orchestrator.persona_nodes import _validate_persona_contract


def test_riley_contract_enforced_when_submit_tool_missing() -> None:
    """Riley must call submit_generation_jobs_tool."""
    result_messages = [
        {"content": "I searched memory", "tool_calls": []},
        {"content": "Done thinking", "tool_calls": []},
    ]
    
    with pytest.raises(RuntimeError, match="failed to call required tools.*submit_generation_jobs_tool"):
        _validate_persona_contract(
            persona="riley",
            project="test_video_gen",
            allowed_tools=["memory_search", "submit_generation_jobs_tool"],
            result_messages=result_messages,
            run_id="test-run",
        )


def test_riley_contract_passes_when_all_required_tools_called() -> None:
    """Riley contract satisfied when both memory_search AND submit_generation_jobs_tool are called."""
    class FakeMessage:
        tool_calls = [
            {"name": "memory_search", "id": "call_1", "args": {"query": "veo3_fast prompting"}},
            {"name": "submit_generation_jobs_tool", "id": "call_2", "args": {"videos": "[]"}},
        ]
    
    result_messages = [FakeMessage()]
    
    # Should not raise
    _validate_persona_contract(
        persona="riley",
        project="test_video_gen",
        allowed_tools=["memory_search", "submit_generation_jobs_tool"],
        result_messages=result_messages,
        run_id="test-run",
    )


def test_riley_contract_fails_when_memory_search_missing() -> None:
    """Riley must call memory_search to load Veo3 guidance."""
    class FakeMessage:
        tool_calls = [
            {"name": "submit_generation_jobs_tool", "id": "call_1", "args": {"videos": "[]"}},
        ]
    
    result_messages = [FakeMessage()]
    
    with pytest.raises(RuntimeError, match="memory_search.*Veo3 prompting guidelines"):
        _validate_persona_contract(
            persona="riley",
            project="test_video_gen",
            allowed_tools=["memory_search", "submit_generation_jobs_tool"],
            result_messages=result_messages,
            run_id="test-run",
        )


def test_alex_contract_enforced_when_render_tool_missing() -> None:
    """Alex must call render_video_timeline_tool at least once."""
    class FakeMessage:
        tool_calls = [
            {"name": "memory_search", "id": "call_1", "args": {}},
            # Missing render_video_timeline_tool
        ]
    
    result_messages = [FakeMessage()]
    
    with pytest.raises(RuntimeError, match="failed to call required tools.*render_video_timeline_tool"):
        _validate_persona_contract(
            persona="alex",
            project="test_video_gen",
            allowed_tools=["memory_search", "render_video_timeline_tool"],
            result_messages=result_messages,
            run_id="test-run",
        )


def test_quinn_contract_enforced_when_publish_tool_missing() -> None:
    """Quinn must call both memory_search AND publish_to_tiktok_tool."""
    class FakeMessage:
        tool_calls = [
            {"name": "memory_search", "id": "call_1", "args": {}},
            # Missing publish_to_tiktok_tool
        ]
    
    result_messages = [FakeMessage()]
    
    with pytest.raises(RuntimeError, match="failed to call required tools.*publish_to_tiktok_tool"):
        _validate_persona_contract(
            persona="quinn",
            project="test_video_gen",
            allowed_tools=["memory_search", "publish_to_tiktok_tool"],
            result_messages=result_messages,
            run_id="test-run",
        )


def test_quinn_contract_enforced_when_memory_search_missing() -> None:
    """Quinn must call memory_search to load platform requirements."""
    class FakeMessage:
        tool_calls = [
            {"name": "publish_to_tiktok_tool", "id": "call_1", "args": {}},
            # Missing memory_search
        ]
    
    result_messages = [FakeMessage()]
    
    with pytest.raises(RuntimeError, match="memory_search.*platform requirements"):
        _validate_persona_contract(
            persona="quinn",
            project="test_video_gen",
            allowed_tools=["memory_search", "publish_to_tiktok_tool"],
            result_messages=result_messages,
            run_id="test-run",
        )


def test_iggy_contract_enforces_memory_search() -> None:
    """Iggy must call memory_search before ideating."""
    result_messages = [{"content": "Storyboarded", "tool_calls": []}]
    
    # Should raise - Iggy didn't call memory_search
    with pytest.raises(RuntimeError, match="memory_search.*creative direction"):
        _validate_persona_contract(
            persona="iggy",
            project="test_video_gen",
            allowed_tools=["memory_search"],
            result_messages=result_messages,
            run_id="test-run",
        )


def test_iggy_contract_passes_when_memory_search_called() -> None:
    """Iggy contract satisfied when memory_search is called."""
    class FakeMessage:
        tool_calls = [
            {"name": "memory_search", "id": "call_1", "args": {"query": "creative direction"}},
            {"name": "memory_search", "id": "call_2", "args": {"query": "aismr modifiers"}},
        ]
    
    result_messages = [FakeMessage()]
    
    # Should not raise
    _validate_persona_contract(
        persona="iggy",
        project="aismr",
        allowed_tools=["memory_search", "transfer_to_riley"],
        result_messages=result_messages,
        run_id="test-run",
    )


def test_contract_validation_handles_attribute_based_tool_calls() -> None:
    """Validate that we can handle message objects with tool_calls attribute."""
    class MessageWithToolCalls:
        def __init__(self, tool_calls):
            self.tool_calls = tool_calls
    
    result_messages = [
        MessageWithToolCalls([
            {"name": "memory_search", "id": "call_1", "args": {}},
            {"name": "submit_generation_jobs_tool", "id": "call_2", "args": {}},
        ])
    ]
    
    # Should not raise - both required tools called
    _validate_persona_contract(
        persona="riley",
        project="test_video_gen",
        allowed_tools=["memory_search", "submit_generation_jobs_tool"],
        result_messages=result_messages,
        run_id="test-run",
    )


def test_contract_validation_handles_empty_messages() -> None:
    """Contract validation should handle empty message lists gracefully."""
    with pytest.raises(RuntimeError, match="failed to call required tools"):
        _validate_persona_contract(
            persona="riley",
            project="test_video_gen",
            allowed_tools=["memory_search", "submit_generation_jobs_tool"],
            result_messages=[],
            run_id="test-run",
        )


def test_alex_contract_passes_when_render_called() -> None:
    """Alex contract satisfied when render is called (memory_search optional)."""
    class FakeMessage:
        tool_calls = [
            {"name": "render_video_timeline_tool", "id": "call_1", "args": {}},
        ]
    
    result_messages = [FakeMessage()]
    
    # Should not raise
    _validate_persona_contract(
        persona="alex",
        project="test_video_gen",
        allowed_tools=["memory_search", "render_video_timeline_tool"],
        result_messages=result_messages,
        run_id="test-run",
    )


def test_quinn_contract_passes_when_all_tools_called() -> None:
    """Quinn contract satisfied when memory_search AND publish are called."""
    class FakeMessage:
        tool_calls = [
            {"name": "memory_search", "id": "call_1", "args": {"query": "tiktok"}},
            {"name": "publish_to_tiktok_tool", "id": "call_2", "args": {}},
        ]
    
    result_messages = [FakeMessage()]
    
    # Should not raise
    _validate_persona_contract(
        persona="quinn",
        project="test_video_gen",
        allowed_tools=["memory_search", "publish_to_tiktok_tool"],
        result_messages=result_messages,
        run_id="test-run",
    )


def test_contract_validation_skips_tools_not_in_allowlist() -> None:
    """If a project disallows a contract tool, validation should not require it."""
    class FakeMessage:
        tool_calls = [
            {"name": "memory_search", "id": "call_1", "args": {}},
        ]

    result_messages = [FakeMessage()]

    # render_video_timeline_tool is required for Alex in _PERSONA_CONTRACTS,
    # but this project only exposes memory_search. Contract should not raise.
    _validate_persona_contract(
        persona="alex",
        project="test_video_gen",
        allowed_tools=["memory_search"],
        result_messages=result_messages,
        run_id="test-run",
    )
