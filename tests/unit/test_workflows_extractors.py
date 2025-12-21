from __future__ import annotations

from myloware.workflows import extractors


def test_aismr_extractor_requires_structured():
    extractor = extractors.get_extractor("aismr")
    assert extractor is not None
    assert extractor("ideas", None) is None


def test_aismr_extractor_builds_overlays():
    extractor = extractors.get_extractor("aismr")
    structured = {"ideas": [{"sign": "Aries", "object": "Crystal Puppy"}]}
    overlays = extractor("ideas", structured)
    assert overlays[0]["identifier"] == "Aries"


def test_motivational_extractor_parses_overlays():
    extractor = extractors.get_extractor("motivational")
    overlays = extractor('(0-1s): "GO"', None)
    assert overlays[0]["text"] == "GO"
