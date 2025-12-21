from __future__ import annotations


from myloware.workflows import validators


def test_validate_objects_no_validator_name_noops() -> None:
    ok, msg = validators.validate_objects(None, ["anything"])
    assert ok is True
    assert msg is None


def test_aismr_objects_validator_rejects_zodiac_names() -> None:
    ok, msg = validators.validate_objects("aismr_objects", ["Aries", "Flame Spirit"])
    assert ok is False
    assert msg and "INVALID OBJECTS" in msg


def test_get_validator_unknown_returns_noop() -> None:
    fn = validators.get_validator("does-not-exist")
    ok, msg = fn(["anything"])
    assert ok is True
    assert msg is None


def test_register_validator_round_trip() -> None:
    def _always_invalid(_objects: list[str]) -> tuple[bool, str | None]:
        return False, "nope"

    validators.register_validator("always_invalid_test", _always_invalid)

    fn = validators.get_validator("always_invalid_test")
    ok, msg = fn(["x"])
    assert ok is False
    assert msg == "nope"

    # Clean up registry mutation to avoid cross-test coupling.
    validators.VALIDATORS.pop("always_invalid_test", None)


def test_validate_objects_uses_named_validator() -> None:
    ok, msg = validators.validate_objects("none", ["anything"])
    assert ok is True
    assert msg is None


def test_aismr_validator_accepts_empty() -> None:
    ok, msg = validators.validate_objects("aismr_objects", [])
    assert ok is True
    assert msg is None


def test_aismr_validator_accepts_non_zodiac_objects() -> None:
    ok, msg = validators.validate_objects("aismr_objects", ["Flame Spirit", "Earth Golem"])
    assert ok is True
    assert msg is None
