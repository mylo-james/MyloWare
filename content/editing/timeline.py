"""Timeline builders for Shotstack-based editing flows."""
from __future__ import annotations

from typing import Any, Iterable, Mapping


def build_timeline(prompt: str, asset_url: str, *, overlay_position: str = "top") -> dict[str, Any]:
    """Create a simple Shotstack timeline that overlays prompt text on the asset."""

    return {
        "timeline": {
            "tracks": [
                {
                    "clips": [
                        {
                            "asset": {
                                "type": "video",
                                "src": asset_url,
                            },
                            "start": 0,
                            "length": 8,
                        }
                    ]
                },
                {
                    "clips": [
                        {
                            "asset": {
                                "type": "title",
                                "text": prompt,
                                "style": "minimal",
                                "size": "small",
                                "color": "#FFFFFF",
                                "background": "#000000AA",
                            },
                            "start": 0,
                            "length": 8,
                            "position": overlay_position,
                            "offset": {
                                "x": 0,
                                "y": -0.35 if overlay_position == "top" else (0.35 if overlay_position == "bottom" else 0),
                            },
                        }
                    ]
                }
            ],
        },
        "output": {
            "format": "mp4",
            "resolution": "1080",
            "fps": 30,
        },
    }


def build_concatenated_timeline(
    clips: Iterable[dict[str, Any]],
    *,
    overlay_style: Mapping[str, Any] | None = None,
    output_settings: Mapping[str, Any] | None = None,
    default_duration: float = 8.0,
) -> dict[str, Any]:
    """Build a Shotstack timeline following the rich template used in production.

    The template matches the structure and styling of our canonical JSON:
    - One primary text track per clip (large header text).
    - One secondary text track per clip (smaller subheader text).
    - One video track per clip with zoom+opacity animation.
    - Output defaults to vertical 9:16, MP4, HD.

    Only the number of clips, their text content, and their video URLs vary.
    """

    # Normalize overlay_style and derive a few overridable constants, but keep
    # the visual style aligned with the canonical template.
    style = dict(overlay_style or {})
    position = style.get("position", "bottom")
    text_color = style.get("color", "#ffffff")
    # Timeline background matches the canonical template; we do not currently
    # expose it via overlay_style to keep the visual stable.
    timeline_background = "#000000"
    primary_font_family = style.get("primaryFontFamily", "Futura")
    primary_font_size = int(style.get("primaryFontSize", 92))
    primary_font_weight = int(style.get("primaryFontWeight", 500))
    primary_height = int(style.get("primaryHeight", 400))
    secondary_font_family = style.get("secondaryFontFamily", primary_font_family)
    secondary_font_size = int(style.get("secondaryFontSize", 64))
    secondary_font_weight = int(style.get("secondaryFontWeight", primary_font_weight))
    secondary_height = int(style.get("secondaryHeight", 250))
    alignment_horizontal = style.get("alignmentHorizontal", "center")
    alignment_vertical = style.get("alignmentVertical", "top")
    text_width = int(style.get("width", 1000))

    # Temporal layout parameters derived from the reference timeline.
    base_text_start = float(style.get("baseTextStart", 0.5))
    text_interval = float(style.get("textInterval", 6.5))
    text_length = float(style.get("textLength", 5.0))
    video_lead = float(style.get("videoLead", 0.5))  # video starts 0.5s before text
    video_length_default = float(style.get("videoLength", default_duration))

    primary_tracks: list[dict[str, Any]] = []
    secondary_tracks: list[dict[str, Any]] = []
    video_tracks: list[dict[str, Any]] = []

    clip_list = list(clips)
    if not clip_list:
        raise ValueError("At least one clip is required to build a concatenated timeline")

    for idx, clip in enumerate(clip_list):
        asset_url = clip.get("assetUrl")
        if not asset_url:
            raise ValueError("Clip missing assetUrl for concatenated timeline")

        # Text content: primary header + optional secondary/subheader.
        primary_text = (
            clip.get("primaryText")
            or clip.get("header")
            or clip.get("subject")
            or clip.get("prompt")
            or clip.get("text")
            or f"Clip {idx + 1}"
        )
        secondary_text = clip.get("secondaryText") or clip.get("subject")

        # Timing per clip, matching the reference spacing:
        # text at 0.5, 7.0, 13.5, ... and video starting 0.5s earlier.
        text_start = base_text_start + text_interval * idx
        video_length = float(clip.get("duration") or video_length_default)
        video_start = text_start - video_lead

        primary_tracks.append(
            {
                "clips": [
                    {
                        "start": text_start,
                        "length": text_length,
                        "position": position,
                        "asset": {
                            "type": "text",
                            "text": primary_text,
                            "width": text_width,
                            "height": primary_height,
                            "alignment": {
                                "horizontal": alignment_horizontal,
                                "vertical": alignment_vertical,
                            },
                            "font": {
                                "weight": primary_font_weight,
                                "family": primary_font_family,
                                "color": text_color,
                                "size": primary_font_size,
                            },
                        },
                        "transition": {"in": "fade", "out": "fade"},
                    }
                ]
            }
        )

        if secondary_text:
            secondary_tracks.append(
                {
                    "clips": [
                        {
                            "start": text_start,
                            "length": text_length,
                            "position": position,
                            "asset": {
                                "type": "text",
                                "text": secondary_text,
                                "width": text_width,
                                "height": secondary_height,
                                "alignment": {
                                    "horizontal": alignment_horizontal,
                                    "vertical": alignment_vertical,
                                },
                                "font": {
                                    "weight": secondary_font_weight,
                                    "family": secondary_font_family,
                                    "color": text_color,
                                    "size": secondary_font_size,
                                },
                            },
                            "transition": {"in": "fade", "out": "fade"},
                        }
                    ]
                }
            )

        # Opacity keyframes: fade in, hold, and optional fade out (omitted on last clip).
        in_duration = 1.0
        out_duration = 1.0
        is_last_clip = idx == len(clip_list) - 1
        if is_last_clip:
            hold_length = max(video_length - in_duration, 0.0)
            opacity_keyframes = [
                {
                    "start": 0.0,
                    "length": in_duration,
                    "from": 0.0,
                    "to": 1.0,
                    "interpolation": "bezier",
                    "easing": "easeInOutSine",
                },
                {
                    "start": in_duration,
                    "length": hold_length,
                    "from": 1.0,
                    "to": 1.0,
                    "interpolation": "linear",
                },
            ]
        else:
            hold_length = max(video_length - in_duration - out_duration, 0.0)
            fade_out_start = in_duration + hold_length
            opacity_keyframes = [
                {
                    "start": 0.0,
                    "length": in_duration,
                    "from": 0.0,
                    "to": 1.0,
                    "interpolation": "bezier",
                    "easing": "easeInOutSine",
                },
                {
                    "start": in_duration,
                    "length": hold_length,
                    "from": 1.0,
                    "to": 1.0,
                    "interpolation": "linear",
                },
                {
                    "start": fade_out_start,
                    "length": out_duration,
                    "from": 1.0,
                    "to": 0.0,
                    "interpolation": "bezier",
                    "easing": "easeInOutSine",
                },
            ]

        video_tracks.append(
            {
                "clips": [
                    {
                        "start": video_start,
                        "length": video_length,
                        "asset": {
                            "type": "video",
                            "src": asset_url,
                        },
                        "offset": {
                            "x": [
                                {
                                    "start": 7.0,
                                    "length": 1.0,
                                    "from": 0.0,
                                    "to": 0.015,
                                    "interpolation": "bezier",
                                    "easing": "easeInOutSine",
                                }
                            ]
                        },
                        "opacity": opacity_keyframes,
                        "effect": "zoomInSlow",
                    }
                ]
            }
        )

    # Default to vertical 9:16 format, HD, MP4.
    default_output: dict[str, Any] = {
        "format": "mp4",
        "resolution": "hd",
        "aspectRatio": "9:16",
        "fps": 30,
    }
    output: dict[str, Any] = {**default_output, **(dict(output_settings) if output_settings else {})}

    return {
        "timeline": {
            "background": timeline_background,
            "tracks": primary_tracks + secondary_tracks + video_tracks,
        },
        "output": output,
    }


__all__ = ["build_timeline", "build_concatenated_timeline"]
