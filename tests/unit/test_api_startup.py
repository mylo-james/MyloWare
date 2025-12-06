"""Tests for API server startup and lifespan."""

import tempfile
from pathlib import Path
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient


def test_load_knowledge_documents_empty_dir():
    """Test loading documents when knowledge dir doesn't exist."""
    with patch("api.server.Path") as mock_path:
        mock_path.return_value.exists.return_value = False

        from api.server import _load_knowledge_documents

        docs = _load_knowledge_documents()
        assert docs == []


def test_load_knowledge_documents_with_files():
    """Test loading documents from knowledge directory."""
    with tempfile.TemporaryDirectory() as tmpdir:
        # Create knowledge directory structure
        knowledge_dir = Path(tmpdir) / "data" / "knowledge"
        knowledge_dir.mkdir(parents=True)
        projects_dir = Path(tmpdir) / "data" / "projects"
        projects_dir.mkdir(parents=True)

        # Create test markdown files
        (knowledge_dir / "test1.md").write_text("# Test Document 1\nContent here.")
        (knowledge_dir / "test2.md").write_text("# Test Document 2\nMore content.")

        # Use a real Path-based approach by patching the base
        import os
        original_cwd = os.getcwd()
        try:
            os.chdir(tmpdir)
            from importlib import reload
            import api.server
            reload(api.server)
            from api.server import _load_knowledge_documents

            docs = _load_knowledge_documents()

            assert len(docs) == 2
            assert all(doc["id"] in ["test1", "test2"] for doc in docs)
            assert all("content" in doc for doc in docs)
            assert all(doc["metadata"]["type"] == "knowledge" for doc in docs)
        finally:
            os.chdir(original_cwd)


def test_health_endpoint_public():
    """Test that health endpoint doesn't require authentication."""
    # Patch the lifespan to skip knowledge setup
    with patch("api.server.lifespan"):
        from api.server import app

        # Force reload without lifespan
        with TestClient(app, raise_server_exceptions=False) as client:
            response = client.get("/health")
            # Should not be 401/403 (auth required)
            assert response.status_code in [200, 500]  # 500 if lifespan failed


def test_authenticated_endpoints_require_key():
    """Test that protected endpoints require API key."""
    with patch("api.server.lifespan"):
        from api.server import app

        with TestClient(app, raise_server_exceptions=False) as client:
            # Runs endpoint requires auth
            response = client.get("/v1/runs/some-id")
            assert response.status_code == 401

            # Chat supervisor endpoint requires auth
            response = client.post("/v1/chat/supervisor", json={"message": "test"})
            assert response.status_code == 401


def test_vector_db_id_from_app_state():
    """Test that vector_db_id dependency uses app state."""
    from fastapi import FastAPI, Request

    from api.dependencies import get_vector_db_id

    # Create mock request with app state
    mock_request = Mock(spec=Request)
    mock_request.app = Mock(spec=FastAPI)
    mock_request.app.state = Mock()
    mock_request.app.state.vector_db_id = "project_kb_test"

    result = get_vector_db_id(mock_request)
    assert result == "project_kb_test"


def test_vector_db_id_default():
    """Test that vector_db_id dependency has a sensible default."""
    from fastapi import FastAPI, Request

    from api.dependencies import get_vector_db_id

    # Create mock request without vector_db_id in state
    mock_request = Mock(spec=Request)
    mock_request.app = Mock(spec=FastAPI)
    mock_request.app.state = Mock(spec=[])  # Empty state

    result = get_vector_db_id(mock_request)
    assert result == "project_kb_myloware"

