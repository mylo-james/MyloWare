"""Unit tests for knowledge base setup."""

from unittest.mock import Mock
from pathlib import Path

import pytest

from knowledge.setup import (
    ingest_documents,
    setup_project_knowledge,
    register_knowledge_base,
    get_existing_vector_store,
)


UPLOAD_CACHE_PATH = Path("data/.kb_upload_cache.json")


def test_get_existing_vector_store_found():
    """Test that existing knowledge base is detected."""
    mock_client = Mock()
    mock_store = Mock()
    mock_store.name = "project_kb_test"  # Function matches by name
    mock_store.id = "vs_12345"  # Returns the ID
    mock_client.vector_stores.list.return_value = [mock_store]

    result = get_existing_vector_store(mock_client, "project_kb_test")

    assert result == "vs_12345"
    mock_client.vector_stores.list.assert_called_once()


def test_get_existing_vector_store_not_found():
    """Test that missing knowledge base returns None."""
    mock_client = Mock()
    mock_client.vector_stores.list.return_value = []

    result = get_existing_vector_store(mock_client, "project_kb_test")

    assert result is None


def test_get_existing_vector_store_error():
    """Test that errors return None."""
    mock_client = Mock()
    mock_client.vector_stores.list.side_effect = Exception("Connection error")

    result = get_existing_vector_store(mock_client, "project_kb_test")

    assert result is None


def test_register_knowledge_base_success():
    """Test successful vector store creation."""
    mock_client = Mock()
    mock_store = Mock()
    mock_store.id = "vs_12345"
    mock_client.vector_stores.create.return_value = mock_store

    vector_store_id = register_knowledge_base(mock_client, "test_project")

    assert vector_store_id == "vs_12345"
    mock_client.vector_stores.create.assert_called_once()
    call_kwargs = mock_client.vector_stores.create.call_args.kwargs
    assert call_kwargs["name"] == "project_kb_test_project"
    assert "chunking_strategy" in call_kwargs


def test_register_knowledge_base_already_exists():
    """Test that already-existing stores are handled gracefully."""
    mock_client = Mock()
    mock_client.vector_stores.create.side_effect = Exception("already exists")

    vector_store_id = register_knowledge_base(mock_client, "existing_project")

    # Returns the expected name even if creation fails with "already exists"
    assert vector_store_id == "project_kb_existing_project"


def test_register_knowledge_base_error():
    """Test that non-idempotent errors are raised."""
    mock_client = Mock()
    mock_client.vector_stores.create.side_effect = Exception("Connection refused")

    with pytest.raises(Exception, match="Connection refused"):
        register_knowledge_base(mock_client, "test_project")


def _build_mock_client() -> Mock:
    # Clear upload cache between tests to avoid reuse masking behavior
    try:
        UPLOAD_CACHE_PATH.unlink()
    except FileNotFoundError:
        pass

    mock_client = Mock()
    mock_store = Mock()
    mock_store.id = "vs_test"
    mock_client.vector_stores.create.return_value = mock_store
    mock_client.vector_stores.list.return_value = []

    mock_file = Mock()
    mock_file.id = "file_12345"
    mock_client.files.create.return_value = mock_file

    return mock_client


def test_ingest_documents_text_content():
    """Test ingesting documents with text content."""
    mock_client = _build_mock_client()

    docs = [
        {"id": "doc1", "content": "Hello world"},
        {"id": "doc2", "content": "Goodbye world"},
    ]

    count = ingest_documents(mock_client, "test_kb", docs)

    assert count == 2
    # Should upload 2 files
    assert mock_client.files.create.call_count == 2
    # Should add files to vector store via batch
    mock_client.vector_stores.file_batches.create.assert_called_once()


def test_ingest_documents_single_file():
    """Test ingesting a single document uses individual file API."""
    mock_client = _build_mock_client()

    docs = [{"id": "doc1", "content": "Hello world"}]

    count = ingest_documents(mock_client, "test_kb", docs)

    assert count == 1
    mock_client.files.create.assert_called_once()
    mock_client.vector_stores.files.create.assert_called_once()


def test_ingest_documents_url_warning():
    """Test that URL documents are skipped with warning."""
    mock_client = _build_mock_client()

    docs = [
        {"id": "url-doc", "url": "https://example.com/doc.txt"},
    ]

    count = ingest_documents(mock_client, "test_kb", docs)

    # URLs are not supported in new API, so count should be 0
    assert count == 0
    mock_client.files.create.assert_not_called()


def test_ingest_documents_with_metadata():
    """Test that metadata filename is used."""
    mock_client = _build_mock_client()

    docs = [
        {
            "id": "doc-meta",
            "content": "Test content",
            "metadata": {"filename": "custom.txt", "source": "test"},
        },
    ]

    ingest_documents(mock_client, "test_kb", docs)

    call_args = mock_client.files.create.call_args
    # The file tuple should include the custom filename
    file_tuple = call_args.kwargs["file"]
    assert file_tuple[0] == "custom.txt"


def test_ingest_documents_auto_id():
    """Test that document IDs are auto-generated if not provided."""
    mock_client = _build_mock_client()

    docs = [{"content": "No ID provided"}]

    count = ingest_documents(mock_client, "test_kb", docs)

    assert count == 1
    mock_client.files.create.assert_called_once()


def test_ingest_documents_missing_content():
    """Test that ValueError is raised when document has no content or url."""
    mock_client = _build_mock_client()

    docs = [
        {"id": "bad-doc", "metadata": {"only": "metadata"}},
    ]

    with pytest.raises(ValueError, match="must have either 'content' or 'url'"):
        ingest_documents(mock_client, "test_kb", docs)


def test_setup_project_knowledge_creates_and_ingests():
    """Test convenience helper creates store and ingests documents."""
    mock_client = _build_mock_client()

    docs = [{"content": "hello"}]

    vector_store_id = setup_project_knowledge(mock_client, "proj", docs)

    assert vector_store_id == "vs_test"
    mock_client.vector_stores.create.assert_called_once()
    mock_client.files.create.assert_called_once()


def test_setup_project_knowledge_skips_ingest_when_no_docs():
    """Ensure ingestion is skipped when no documents provided."""
    mock_client = _build_mock_client()

    setup_project_knowledge(mock_client, "proj", documents=None)

    mock_client.files.create.assert_not_called()


def test_setup_project_knowledge_skips_when_exists():
    """Test that setup is skipped when knowledge base already exists."""
    mock_client = Mock()
    mock_store = Mock()
    mock_store.name = "project_kb_proj"  # Function matches by name
    mock_store.id = "vs_existing_123"  # Returns the ID
    mock_client.vector_stores.list.return_value = [mock_store]

    # Mock vector_store_has_files to return True (has documents)
    mock_client.vector_stores.files.list.return_value = [Mock()]

    vector_store_id = setup_project_knowledge(mock_client, "proj", documents=[{"content": "test"}])

    # Should return existing ID without creating
    assert vector_store_id == "vs_existing_123"
    mock_client.vector_stores.create.assert_not_called()
