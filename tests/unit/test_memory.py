"""Tests for memory bank management."""

from unittest.mock import MagicMock


class TestMemoryBanks:
    """Tests for memory bank operations."""

    def test_register_memory_bank(self):
        from myloware.memory.banks import register_memory_bank

        mock_client = MagicMock()

        register_memory_bank(mock_client, "test-bank")

        mock_client.memory_banks.register.assert_called_once()
        call_args = mock_client.memory_banks.register.call_args
        assert call_args.kwargs["memory_bank_id"] == "test-bank"

    def test_insert_memory(self):
        from myloware.memory.banks import USER_PREFERENCES_BANK, insert_memory

        mock_client = MagicMock()

        insert_memory(
            mock_client,
            user_id="user-123",
            content="User prefers moon videos",
        )

        mock_client.memory.insert.assert_called_once()
        call_args = mock_client.memory.insert.call_args
        assert call_args.kwargs["memory_bank_id"] == USER_PREFERENCES_BANK
        docs = call_args.kwargs["documents"]
        assert len(docs) == 1
        assert docs[0]["content"] == "User prefers moon videos"

    def test_query_memory(self):
        from myloware.memory.banks import query_memory

        mock_client = MagicMock()
        mock_client.memory.query.return_value.chunks = [{"content": "User prefers moon videos"}]

        result = query_memory(
            mock_client,
            user_id="user-123",
            query="video preferences",
        )

        assert len(result) == 1
        assert result[0]["content"] == "User prefers moon videos"

    def test_query_memory_filters_other_users(self):
        from myloware.memory.banks import query_memory

        mock_client = MagicMock()
        mock_client.memory.query.return_value.chunks = [
            {"content": "secret", "metadata": {"user_id": "someone-else"}}
        ]

        result = query_memory(mock_client, user_id="user-123", query="*")
        assert result == []

    def test_clear_user_memory(self):
        from myloware.memory.banks import clear_user_memory

        mock_client = MagicMock()
        mock_client.memory.query.return_value.chunks = [
            {"document_id": "user-123:1", "content": "pref"},
            {"document_id": "user-123:2", "content": "pref2"},
        ]

        clear_user_memory(mock_client, user_id="user-123")

        mock_client.memory.delete.assert_called_once()
        doc_ids = mock_client.memory.delete.call_args.kwargs["document_ids"]
        assert len(doc_ids) == 2

    def test_clear_user_memory_returns_when_empty(self):
        from myloware.memory.banks import clear_user_memory

        mock_client = MagicMock()
        mock_client.memory.query.return_value.chunks = []

        clear_user_memory(mock_client, user_id="user-123")
        mock_client.memory.delete.assert_not_called()


class TestPreferenceExtraction:
    """Tests for preference extraction."""

    def test_extracts_preference(self):
        from myloware.memory.preferences import extract_and_store_preference

        mock_client = MagicMock()

        result = extract_and_store_preference(
            mock_client,
            user_id="user-123",
            message="I prefer moon videos over sun videos",
        )

        assert result is True
        mock_client.memory.insert.assert_called_once()

    def test_ignores_non_preference(self):
        from myloware.memory.preferences import extract_and_store_preference

        mock_client = MagicMock()

        result = extract_and_store_preference(
            mock_client,
            user_id="user-123",
            message="Start a motivational run",
        )

        assert result is False
        mock_client.memory.insert.assert_not_called()
