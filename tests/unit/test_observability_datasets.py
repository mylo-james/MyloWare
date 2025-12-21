from __future__ import annotations

from dataclasses import dataclass
from types import SimpleNamespace
from typing import Any

import pytest

from myloware.observability.datasets import append_rows, get_rows, register_dataset


@dataclass
class _Calls:
    register: list[dict[str, Any]]
    append_rows: list[dict[str, Any]]
    iterrows: list[dict[str, Any]]


class _FakeDatasets:
    def __init__(self, calls: _Calls) -> None:
        self._calls = calls

    def register(self, **kwargs: Any) -> None:
        self._calls.register.append(dict(kwargs))

    def iterrows(self, **kwargs: Any) -> Any:
        self._calls.iterrows.append(dict(kwargs))
        return SimpleNamespace(rows=[{"a": 1}, {"b": 2}])


class _FakeDatasetIO:
    def __init__(self, calls: _Calls) -> None:
        self._calls = calls

    def append_rows(self, **kwargs: Any) -> None:
        self._calls.append_rows.append(dict(kwargs))


class _FakeClient:
    def __init__(self, *, with_datasetio: bool) -> None:
        self.calls = _Calls(register=[], append_rows=[], iterrows=[])
        self.datasets = _FakeDatasets(self.calls)
        if with_datasetio:
            self.datasetio = _FakeDatasetIO(self.calls)


def test_register_dataset_requires_rows_xor_uri() -> None:
    client = _FakeClient(with_datasetio=False)
    with pytest.raises(ValueError, match="either rows or uri"):
        register_dataset(client, dataset_id="ds", rows=[{"q": "a"}], uri="s3://bucket/key")


def test_register_dataset_uses_uri_source() -> None:
    client = _FakeClient(with_datasetio=False)
    register_dataset(client, dataset_id="ds", uri="s3://bucket/key", metadata={"m": 1})

    assert client.calls.register
    call = client.calls.register[0]
    assert call["dataset_id"] == "ds"
    assert call["purpose"] == "eval/question-answer"
    assert call["source"]["type"] == "uri"
    assert call["source"]["uri"] == "s3://bucket/key"
    assert call["metadata"] == {"m": 1}


def test_append_rows_requires_datasetio() -> None:
    client = _FakeClient(with_datasetio=False)
    with pytest.raises(RuntimeError, match="datasetio.append_rows"):
        append_rows(client, dataset_id="ds", rows=[{"q": "a"}])


def test_append_rows_and_get_rows_success() -> None:
    client = _FakeClient(with_datasetio=True)
    append_rows(client, dataset_id="ds", rows=[{"q": "a"}, {"q": "b"}])

    assert client.calls.append_rows == [
        {"dataset_id": "ds", "rows": [{"q": "a"}, {"q": "b"}]},
    ]

    rows = get_rows(client, dataset_id="ds", limit=2, start_index=7)
    assert rows == [{"a": 1}, {"b": 2}]
    assert client.calls.iterrows == [{"dataset_id": "ds", "limit": 2, "start_index": 7}]
