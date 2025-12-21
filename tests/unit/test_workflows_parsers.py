from __future__ import annotations

from myloware.workflows import parsers


def test_parse_structured_ideation_fenced_json():
    text = 'Ideas:\n```json\n{"ideas": ["a", "b"], "topic": "x"}\n```'
    parsed = parsers.parse_structured_ideation(text)
    assert parsed is not None
    assert parsed["ideas"] == ["a", "b"]


def test_parse_structured_ideation_invalid_json_returns_none():
    text = "```json\n{not-json}\n```"
    assert parsers.parse_structured_ideation(text) is None


def test_extract_topic_from_brief_patterns():
    assert parsers.extract_topic_from_brief("run aismr about puppies") == "puppies"
    assert parsers.extract_topic_from_brief("Create an ASMR video featuring cats.") == "cats"
    assert parsers.extract_topic_from_brief("asmr about rain!") == "rain"
    assert parsers.extract_topic_from_brief("We should learn about turtles.") == "turtles"


def test_extract_overlays_motivational_and_voice_over():
    text = '(0-4s): "FOCUS"\n' '(4-8s): "GRIT"\n' '**Voice Over:** "keep going"\n'
    overlays = parsers.extract_overlays_motivational(text)
    assert len(overlays) == 2
    assert overlays[0]["text"] == "FOCUS"
    assert overlays[0]["voice_over"] == "keep going"


def test_extract_overlays_aismr():
    zodiac_objects = {"Aries": {"object": "Crystal Puppy"}}
    overlays = parsers.extract_overlays_aismr("ideas", zodiac_objects)
    assert overlays[0]["identifier"] == "Aries"
    assert overlays[0]["text"] == "Crystal Puppy"
    assert overlays[0]["start_s"] == 0


def test_extract_overlays_motivational_no_matches():
    overlays = parsers.extract_overlays_motivational("no overlays here")
    assert overlays == []
