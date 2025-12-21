"""Llama Stack dataset management using Dataset APIs."""

from __future__ import annotations

from typing import Any, Iterable, List

from llama_stack_client import LlamaStackClient
from llama_stack_client.types.dataset_register_params import (
    SourceRowsDataSource,
    SourceUriDataSource,
)
from myloware.observability.logging import get_logger

logger = get_logger("observability.datasets")

__all__ = ["register_dataset", "append_rows", "get_rows"]


def register_dataset(
    client: LlamaStackClient,
    dataset_id: str,
    purpose: str = "eval/question-answer",
    rows: Iterable[dict[str, Any]] | None = None,
    uri: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    """
    Register a dataset with Llama Stack.

    Args:
        client: Llama Stack client.
        dataset_id: Unique identifier for the dataset.
        purpose: Dataset purpose (e.g., eval/question-answer).
        rows: Optional iterable of row dicts to seed the dataset.
        uri: Optional URI pointing to existing dataset content.
        metadata: Optional metadata to store alongside the dataset.
    """

    if rows is not None and uri is not None:
        raise ValueError("Provide either rows or uri, not both")

    if uri:
        source = SourceUriDataSource(type="uri", uri=uri)
    else:
        seed_rows: List[dict[str, Any]] = list(rows) if rows is not None else []
        source = SourceRowsDataSource(type="rows", rows=seed_rows)

    logger.info("Registering dataset '%s' (purpose=%s)", dataset_id, purpose)
    client.datasets.register(
        dataset_id=dataset_id,
        purpose=purpose,
        source=source,
        metadata=metadata or {},
    )


def append_rows(
    client: LlamaStackClient,
    dataset_id: str,
    rows: Iterable[dict[str, Any]],
) -> None:
    """
    Append rows to a dataset using DatasetIO if available.

    Raises:
        RuntimeError: If the client does not expose datasetio.append_rows.
    """

    if not hasattr(client, "datasetio"):
        raise RuntimeError(
            "client.datasetio.append_rows is not available on this Llama Stack client"
        )

    rows_list = list(rows)
    logger.info("Appending %s rows to dataset '%s'", len(rows_list), dataset_id)
    client.datasetio.append_rows(dataset_id=dataset_id, rows=rows_list)


def get_rows(
    client: LlamaStackClient,
    dataset_id: str,
    limit: int = 100,
    start_index: int | None = None,
) -> list[dict[str, Any]]:
    """Get rows from a dataset."""

    logger.info("Fetching rows from dataset '%s' (limit=%s)", dataset_id, limit)
    response = client.datasets.iterrows(
        dataset_id=dataset_id,
        limit=limit,
        start_index=start_index or 0,
    )
    # DatasetIterrowsResponse.rows is already a list of dicts
    return list(response.rows)
