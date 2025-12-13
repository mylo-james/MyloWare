"""MyloWare observability module - Logging and telemetry.

Observability is handled at two levels:
1. **Logging**: Structured JSON logs via structlog
2. **Telemetry**: Llama Stack native telemetry (traces exported to Jaeger)

We do NOT set up our own OpenTelemetry SDK - Llama Stack handles all
trace export via its telemetry API. Query traces via:
    client.telemetry.query_traces()
    client.telemetry.get_trace(trace_id)

Usage:
    from observability import get_logger

    logger = get_logger(__name__)
    logger.info("Starting workflow", run_id=run_id)
"""

from observability.logging import configure_logging, get_logger

__all__ = [
    # Logging
    "configure_logging",
    "get_logger",
]

# Configure logging on module import so all loggers use structured JSON.
configure_logging()
