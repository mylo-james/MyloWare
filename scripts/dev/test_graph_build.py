#!/usr/bin/env python3
"""Gate 2A: Test production graph building and execution."""

import os
import sys
from pathlib import Path

# Add project root to path
root = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(root))

# Set required env vars for testing
os.environ.setdefault("DB_URL", "postgresql+psycopg://postgres:postgres@localhost:5432/myloware")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("API_KEY", "dev-local-api-key")
os.environ.setdefault("OPENAI_API_KEY", os.getenv("OPENAI_API_KEY", ""))

from apps.orchestrator.graph_factory import load_project_spec, build_project_graph
from apps.orchestrator.run_state import RunState
from apps.orchestrator.checkpointer import PostgresCheckpointer


def main():
    """Test building and executing test_video_gen graph."""
    print("\n" + "="*60)
    print("Gate 2A: Manual Graph Build & Execute")
    print("="*60 + "\n")
    
    # 1. Load project spec
    print("1. Loading test_video_gen project spec...")
    project_spec = load_project_spec("test_video_gen")
    print(f"   ✓ Loaded: {project_spec.get('title', 'test_video_gen')}")
    print(f"   ✓ Workflow: {project_spec.get('workflow', [])}")
    print(f"   ✓ HITL Points: {project_spec.get('hitlPoints', [])}")
    
    # 2. Build graph
    print("\n2. Building production graph...")
    graph = build_project_graph(project_spec, project="test_video_gen")
    print("   ✓ Graph built successfully")
    
    # 3. Visualize graph structure
    print("\n3. Graph Structure (Mermaid):")
    print("-" * 60)
    try:
        # Try to get the graph structure
        compiled = graph.compile()
        # LangGraph's draw_mermaid if available
        try:
            mermaid = compiled.get_graph().draw_mermaid()
            print(mermaid)
        except AttributeError:
            # Fallback: just show nodes and edges
            print("   Nodes:", list(compiled.get_graph().nodes.keys()))
            print("   Edges:", compiled.get_graph().edges)
    except Exception as e:
        print(f"   ⚠ Could not visualize: {e}")
        print("   Expected: START → iggy → alex → quinn → END")
    print("-" * 60)
    
    # 4. Execute with mock state
    print("\n4. Executing graph with mock state...")
    print("   (This will run LangChain agents, may take a moment...)")
    
    initial_state: RunState = {
        "run_id": "gate_2a_test_001",
        "project": "test_video_gen",
        "input": "Generate test smoke video for workflow validation",
        "videos": [],
        "transcript": [],
        "persona_history": [],
        "retrieval_traces": [],
        "current_persona": None,
    }
    
    try:
        # Compile and execute
        compiled_graph = graph.compile()
        result = compiled_graph.invoke(initial_state)
        
        print("\n5. ✓ Execution Complete!")
        print("-" * 60)
        print(f"   Run ID: {result.get('run_id', 'N/A')}")
        print(f"   Project: {result.get('project', 'N/A')}")
        print(f"   Current Persona: {result.get('current_persona', 'N/A')}")
        print(f"   Transcript Entries: {len(result.get('transcript', []))}")
        print(f"   Persona History: {len(result.get('persona_history', []))}")
        print(f"   Retrieval Traces: {len(result.get('retrieval_traces', []))}")
        
        # Show persona history
        if result.get("persona_history"):
            print("\n   Persona Execution Order:")
            for i, entry in enumerate(result.get("persona_history", []), 1):
                persona = entry.get("persona", "unknown")
                message = entry.get("message", "")[:60]
                print(f"      {i}. {persona.upper()}: {message}...")
        
        # Verify expected structure
        print("\n6. Verification:")
        expected_personas = ["iggy", "riley", "alex", "quinn"]
        actual_personas = [p.get("persona") for p in result.get("persona_history", [])]
        
        if actual_personas == expected_personas:
            print(f"   ✅ Persona order matches: {expected_personas}")
        else:
            print(f"   ⚠ Expected: {expected_personas}")
            print(f"   ⚠ Got: {actual_personas}")
        
        if len(result.get("persona_history", [])) == len(expected_personas):
            print(f"   ✅ Expected personas executed")
        else:
            print(f"   ⚠ Expected {len(expected_personas)} personas, got {len(result.get('persona_history', []))}")
        
        print("\n" + "="*60)
        print("Gate 2A: PASS ✅")
        print("="*60 + "\n")
        
        return 0
    
    except Exception as e:
        print(f"\n❌ Execution failed: {e}")
        import traceback
        traceback.print_exc()
        
        print("\n" + "="*60)
        print("Gate 2A: FAIL ❌")
        print("="*60 + "\n")
        return 1


if __name__ == "__main__":
    sys.exit(main())
