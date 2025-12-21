"""Project-specific validators for workflow inputs.

Validators are registered by name and can be referenced in project config files.
This keeps business logic (like AISMR zodiac validation) out of generic tools.
"""

from __future__ import annotations

from typing import Callable, Dict, List, Optional

from myloware.observability.logging import get_logger

logger = get_logger(__name__)

# Type alias for validator functions
# Returns (is_valid, error_message)
ValidatorFn = Callable[[List[str]], tuple[bool, Optional[str]]]


# Zodiac signs (case-insensitive) - used by AISMR project
ZODIAC_SIGNS = {
    "aries",
    "taurus",
    "gemini",
    "cancer",
    "leo",
    "virgo",
    "libra",
    "scorpio",
    "sagittarius",
    "capricorn",
    "aquarius",
    "pisces",
}


def _aismr_object_validator(objects: List[str]) -> tuple[bool, Optional[str]]:
    """Validate AISMR objects are not zodiac sign names.

    AISMR videos use zodiac signs for clip segments but require CREATIVE OBJECT
    names for the text overlays (e.g., 'Flame Spirit', not 'Aries').
    """
    if not objects:
        return True, None

    invalid_objects = [o for o in objects if o.lower() in ZODIAC_SIGNS]
    if invalid_objects:
        return False, (
            f"INVALID OBJECTS: {invalid_objects} are zodiac SIGNS, not creative object names! "
            f"Objects should be creative names like 'Flame Spirit', 'Earth Golem', etc. "
            f"Check the 'Objects (in order)' section of your input and use those exact values."
        )
    return True, None


def _no_validation(objects: List[str]) -> tuple[bool, Optional[str]]:
    """Default validator that accepts any input."""
    return True, None


# Registry of validators by name
VALIDATORS: Dict[str, ValidatorFn] = {
    "aismr_objects": _aismr_object_validator,
    "none": _no_validation,
}


def get_validator(name: str) -> ValidatorFn:
    """Get a validator by name. Returns no-op validator if not found."""
    validator = VALIDATORS.get(name)
    if validator is None:
        logger.debug("Validator '%s' not found, using no-op", name)
        return _no_validation
    return validator


def validate_objects(
    validator_name: str | None,
    objects: List[str],
) -> tuple[bool, Optional[str]]:
    """Validate objects using the named validator.

    Args:
        validator_name: Name of the validator to use (from project config)
        objects: List of objects to validate

    Returns:
        Tuple of (is_valid, error_message)
    """
    if not validator_name:
        return True, None

    validator = get_validator(validator_name)
    return validator(objects)


def register_validator(name: str, fn: ValidatorFn) -> None:
    """Register a new validator function."""
    VALIDATORS[name] = fn


__all__ = [
    "ValidatorFn",
    "ZODIAC_SIGNS",
    "get_validator",
    "validate_objects",
    "register_validator",
]
