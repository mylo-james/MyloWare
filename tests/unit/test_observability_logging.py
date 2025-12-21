from __future__ import annotations

from myloware.observability.logging import get_logger


def test_get_logger_supports_none_name() -> None:
    logger = get_logger()
    assert logger is not None
