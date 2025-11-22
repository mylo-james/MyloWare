from __future__ import annotations

import logging

from adapters.observability.logging_filters import InfoSamplingFilter, install_info_sampling_filter


def _make_record(name: str, level: int) -> logging.LogRecord:
    return logging.LogRecord(name=name, level=level, pathname=__file__, lineno=0, msg="test", args=(), exc_info=None)


def test_info_sampling_filter_noop_in_non_prod() -> None:
    flt = InfoSamplingFilter(environment="local", rate=0.1, randfunc=lambda: 0.99)
    record = _make_record("myloware.api.sample", logging.INFO)
    assert flt.filter(record) is True


def test_info_sampling_filter_samples_info_in_prod() -> None:
    # When random value is below rate threshold, log is kept.
    flt_allow = InfoSamplingFilter(environment="prod", rate=0.1, randfunc=lambda: 0.05)
    record = _make_record("myloware.api.sample", logging.INFO)
    assert flt_allow.filter(record) is True

    # When random value is above rate threshold, log is dropped.
    flt_drop = InfoSamplingFilter(environment="prod", rate=0.1, randfunc=lambda: 0.95)
    record2 = _make_record("myloware.api.sample", logging.INFO)
    assert flt_drop.filter(record2) is False


def test_info_sampling_filter_always_keeps_warnings_and_errors() -> None:
    flt = InfoSamplingFilter(environment="prod", rate=0.01, randfunc=lambda: 0.99)
    warn_record = _make_record("myloware.api.sample", logging.WARNING)
    error_record = _make_record("myloware.api.sample", logging.ERROR)
    assert flt.filter(warn_record) is True
    assert flt.filter(error_record) is True


def test_install_info_sampling_filter_attaches_to_logger() -> None:
    logger = logging.getLogger("myloware.test.logger")
    # Ensure we start from a clean slate for this test.
    logger.filters.clear()
    flt = install_info_sampling_filter("prod", logger=logger, rate=0.5)
    assert flt in logger.filters

