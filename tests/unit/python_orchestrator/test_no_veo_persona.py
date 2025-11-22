from __future__ import annotations

import json
from pathlib import Path

PROJECTS_DIR = Path(__file__).resolve().parents[3] / "data" / "projects"


def _load_json(path: Path) -> dict[str, object] | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _assert_no_veo(workflow: list[object], path: Path) -> None:
    normalized = [str(entry).strip().lower() for entry in workflow]
    assert "veo" not in normalized, f"{path} still references deprecated persona 'veo'"


def test_project_and_workflow_specs_do_not_reference_veo() -> None:
    """Project specs and workflow descriptors must not contain the retired persona."""
    project_files = list(PROJECTS_DIR.glob("*/project.json"))
    workflow_files = list(PROJECTS_DIR.glob("*/workflow.json"))
    root_project_files = [
        path for path in PROJECTS_DIR.glob("*.json") if path.name not in {"README.json"}
    ]

    assert project_files, "expected at least one project.json entry"

    for path in (*project_files, *root_project_files, *workflow_files):
        data = _load_json(path)
        if not isinstance(data, dict):
            continue
        workflow = data.get("workflow")
        if isinstance(workflow, list):
            _assert_no_veo(workflow, path)


def test_agent_expectations_do_not_reference_veo() -> None:
    """Agent expectations files should not contain Veo-specific guidance anymore."""
    expectation_files = list(PROJECTS_DIR.glob("**/agent-expectations.json"))
    assert expectation_files, "expected agent expectation specs"

    for path in expectation_files:
        content = path.read_text(encoding="utf-8").lower()
        assert '"veo"' not in content, f"{path} still mentions retired persona 'veo'"
