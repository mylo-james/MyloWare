"""Llama Stack telemetry integration helpers."""

from __future__ import annotations

from typing import Iterable, List, Sequence

from llama_stack_client import LlamaStackClient
from llama_stack_client.types.query_condition_param import QueryConditionParam
from llama_stack_client.types.telemetry_query_traces_response import TelemetryQueryTracesResponse
from llama_stack_client.types.trace import Trace
from myloware.observability.logging import get_logger

logger = get_logger(__name__)

__all__ = [
    "query_run_traces",
    "get_trace_details",
    "export_run_spans_to_dataset",
]


def _run_filter(run_id: str) -> QueryConditionParam:
    """Create an attribute filter that scopes telemetry to a specific run_id."""

    return QueryConditionParam(key="attributes.run_id", op="eq", value=run_id)


def query_run_traces(
    client: LlamaStackClient,
    run_id: str,
    limit: int = 50,
) -> TelemetryQueryTracesResponse:
    """
    Query telemetry traces for a given run_id.

    Args:
        client: Llama Stack client instance.
        run_id: Workflow run identifier to filter traces.
        limit: Maximum number of traces to return.
    """

    logger.info("Querying telemetry traces for run_id=%s limit=%s", run_id, limit)
    filters: Iterable[QueryConditionParam] = [_run_filter(run_id)]
    return client.telemetry.query_traces(attribute_filters=filters, limit=limit)


def get_trace_details(client: LlamaStackClient, trace_id: str) -> Trace:
    """Retrieve a single trace by ID."""

    logger.info("Fetching telemetry trace details trace_id=%s", trace_id)
    return client.telemetry.get_trace(trace_id=trace_id)


def export_run_spans_to_dataset(
    client: LlamaStackClient,
    run_id: str,
    dataset_id: str,
    attributes_to_save: Sequence[str] | None = None,
    max_depth: int | None = None,
) -> None:
    """
    Export spans for a run into a telemetry dataset for downstream analysis.

    Args:
        client: Llama Stack client instance.
        run_id: Workflow run identifier to filter spans.
        dataset_id: Target dataset identifier in Llama Stack.
        attributes_to_save: Additional span attributes to persist.
        max_depth: Optional depth limit when traversing span trees.
    """

    attrs: List[str] = ["attributes.run_id", "attributes.step", "name", "duration_ms"]
    if attributes_to_save:
        attrs.extend(attributes_to_save)

    logger.info(
        "Saving spans to dataset=%s for run_id=%s max_depth=%s attrs=%s",
        dataset_id,
        run_id,
        max_depth,
        attrs,
    )

    client.telemetry.save_spans_to_dataset(
        attribute_filters=[_run_filter(run_id)],
        attributes_to_save=attrs,
        dataset_id=dataset_id,
        max_depth=max_depth if max_depth is not None else 5,
    )
