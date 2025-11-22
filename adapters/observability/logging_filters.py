from __future__ import annotations

import logging
import random
from typing import Callable


class InfoSamplingFilter(logging.Filter):
    """Filter that samples INFO-level logs in production.

    The goal is to keep high-cardinality application logs manageable while
    preserving full ERROR/WARNING visibility. In non-production environments
    the filter is effectively disabled.
    """

    def __init__(
        self,
        *,
        environment: str,
        rate: float = 0.1,
        logger_name_prefix: str = "myloware.",
        randfunc: Callable[[], float] | None = None,
    ) -> None:
        super().__init__()
        self._environment = (environment or "").lower()
        self._rate = rate
        self._logger_name_prefix = logger_name_prefix
        self._randfunc = randfunc or random.random

    def filter(self, record: logging.LogRecord) -> bool:
        # Only sample in production; keep full logs elsewhere.
        if self._environment != "prod":
            return True

        # Never sample warnings or errors.
        if record.levelno >= logging.WARNING:
            return True

        # Only apply sampling to INFO logs for MyloWare namespaces.
        if record.levelno != logging.INFO:
            return True
        if not str(record.name).startswith(self._logger_name_prefix):
            return True

        return self._randfunc() < self._rate


def install_info_sampling_filter(environment: str, *, logger: logging.Logger | None = None, rate: float = 0.1) -> InfoSamplingFilter:
    """Attach an InfoSamplingFilter to the given logger (or root).

    This is intended for use in service startup code; unit tests can pass an
    explicit logger instance to avoid mutating global logging configuration.
    """
    target = logger or logging.getLogger()
    flt = InfoSamplingFilter(environment=environment, rate=rate)
    target.addFilter(flt)
    return flt


__all__ = ["InfoSamplingFilter", "install_info_sampling_filter"]
