"""Unit tests for telemetry helpers."""

from __future__ import annotations

from myloware.observability import telemetry


class FakeTelemetry:
    def __init__(self):
        self.query_args = {}
        self.trace_id = None
        self.saved_args = {}

    def query_traces(self, *, attribute_filters, limit=None, **_kwargs):
        self.query_args = {"filters": attribute_filters, "limit": limit}
        return ["trace-a"]

    def get_trace(self, trace_id: str, **_kwargs):
        self.trace_id = trace_id
        return {"id": trace_id}

    def save_spans_to_dataset(
        self,
        *,
        attribute_filters,
        attributes_to_save,
        dataset_id,
        max_depth=None,
        **_kwargs,
    ):
        self.saved_args = {
            "filters": attribute_filters,
            "attrs": attributes_to_save,
            "dataset_id": dataset_id,
            "max_depth": max_depth,
        }


class FakeClient:
    def __init__(self):
        self.telemetry = FakeTelemetry()


def test_query_run_traces_filters_by_run_id():
    client = FakeClient()

    traces = telemetry.query_run_traces(client, run_id="run-123", limit=5)

    assert traces == ["trace-a"]
    filters = client.telemetry.query_args["filters"]
    assert len(filters) == 1
    assert filters[0]["key"] == "attributes.run_id"
    assert filters[0]["value"] == "run-123"
    assert client.telemetry.query_args["limit"] == 5


def test_get_trace_details_calls_client():
    client = FakeClient()

    trace = telemetry.get_trace_details(client, trace_id="trace-1")

    assert trace == {"id": "trace-1"}
    assert client.telemetry.trace_id == "trace-1"


def test_export_run_spans_to_dataset_uses_filters_and_attrs():
    client = FakeClient()

    telemetry.export_run_spans_to_dataset(
        client=client,
        run_id="run-xyz",
        dataset_id="ds-1",
        attributes_to_save=["attributes.custom"],
        max_depth=2,
    )

    saved = client.telemetry.saved_args
    assert saved["dataset_id"] == "ds-1"
    assert saved["max_depth"] == 2
    filters = saved["filters"]
    assert len(filters) == 1
    assert filters[0]["value"] == "run-xyz"
    assert "attributes.run_id" in saved["attrs"]
    assert "attributes.custom" in saved["attrs"]
