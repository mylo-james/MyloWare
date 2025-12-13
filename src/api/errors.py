"""Domain-specific exceptions and helpers for consistent API errors."""

from __future__ import annotations

from fastapi import HTTPException, status


class DomainError(Exception):
    """Base class for domain errors."""

    error: str = "domain_error"
    status_code: int = status.HTTP_400_BAD_REQUEST

    def __init__(self, message: str, *, error: str | None = None, status_code: int | None = None):
        super().__init__(message)
        if error:
            self.error = error
        if status_code:
            self.status_code = status_code


class ValidationError(DomainError):
    error = "validation_error"
    status_code = status.HTTP_400_BAD_REQUEST


class ConfigurationError(DomainError):
    error = "configuration_error"
    status_code = status.HTTP_500_INTERNAL_SERVER_ERROR


class WorkflowError(DomainError):
    error = "workflow_error"
    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY


def to_http_exception(err: DomainError) -> HTTPException:
    """Convert DomainError to HTTPException with consistent payload."""
    return HTTPException(
        status_code=err.status_code,
        detail={"error": err.error, "detail": str(err)},
    )
