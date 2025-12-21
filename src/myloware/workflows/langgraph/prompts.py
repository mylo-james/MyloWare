"""Prompt builders for LangGraph workflow nodes.

Keeping prompt construction separate from orchestration logic makes the workflow
nodes easier to read and maintain, and keeps project-specific branching in one
place.
"""

from __future__ import annotations

import json
from typing import Any, Mapping

from myloware.config.projects import load_project

__all__ = [
    "build_editor_prompt",
    "build_publisher_prompt",
]


def build_editor_prompt(
    *,
    project: str,
    clip_urls: list[str],
    creative_direction: str,
    overlays: Any,
    duration_seconds: float,
) -> str:
    """Build the editor prompt for composing clips into a final video."""
    overlays_list: list[Any] = overlays if isinstance(overlays, list) else []

    if project == "aismr":
        objects: list[str] = []
        for item in overlays_list:
            if isinstance(item, Mapping):
                text = item.get("text") or item.get("identifier") or ""
                if text:
                    objects.append(str(text))
        return (
            f"Render an ASMR video with 12 segments (one per zodiac sign) using the 'aismr' template.\n\n"
            f"## CLIPS (use these EXACT URLs):\n{json.dumps(clip_urls, indent=2)}\n\n"
            f"## OBJECTS (use these EXACT names - NOT zodiac signs!):\n{json.dumps(objects, indent=2)}\n\n"
            f"CRITICAL: Call remotion_render tool with:\n"
            f"- template: 'aismr'\n"
            f"- clips: {json.dumps(clip_urls)}\n"
            f"- objects: {json.dumps(objects)}\n"
            f"- duration_seconds: {duration_seconds}\n"
            f"- fps: 30\n"
            f"- aspect_ratio: '9:16'\n\n"
            f"DO NOT just output code - you MUST call the remotion_render tool!"
        )

    if project == "motivational":
        texts_motivational: list[str] = []
        for idx, item in enumerate(overlays_list):
            if isinstance(item, Mapping):
                texts_motivational.append(
                    str(item.get("text") or item.get("identifier") or f"TEXT {idx + 1}")
                )
            else:
                texts_motivational.append(f"TEXT {idx + 1}")
        while len(texts_motivational) < 4:
            texts_motivational.append(f"TEXT {len(texts_motivational) + 1}")
        return (
            f"Render a motivational video with the 'motivational' template.\n\n"
            f"## CLIPS (use these EXACT URLs):\n{json.dumps(clip_urls, indent=2)}\n\n"
            f"## TEXT OVERLAYS (use these EXACT texts):\n{json.dumps(texts_motivational[:4], indent=2)}\n\n"
            f"CRITICAL: Call remotion_render tool with:\n"
            f"- template: 'motivational'\n"
            f"- clips: {json.dumps(clip_urls)}\n"
            f"- texts: {json.dumps(texts_motivational[:4])}\n"
            f"- duration_seconds: {duration_seconds}\n"
            f"- fps: 30\n"
            f"- aspect_ratio: '9:16'\n\n"
            f"DO NOT just output code - you MUST call the remotion_render tool!"
        )

    return (
        f"You have {len(clip_urls)} video clips to compose:\n"
        f"{json.dumps(clip_urls, indent=2)}\n\n"
        f"Creative direction/ideation:\n{creative_direction}\n\n"
        f"WORKFLOW (recommended):\n"
        f"1. **Analyze clips first** (optional but recommended):\n"
        f"   - Use `analyze_media` tool on each clip to understand content, colors, composition\n"
        f"   - Extract color palettes and composition details\n"
        f"   - Get transition and pacing recommendations\n"
        f"2. **Make informed creative decisions**:\n"
        f"   - Choose transitions based on clip content (soft dissolve for calm, cuts for energetic)\n"
        f"   - Match pacing to content type\n"
        f"   - Apply extracted colors to text overlays and styling\n"
        f"3. **Create composition**:\n"
        f"   - Use templates (aismr, motivational) OR write custom TSX code\n"
        f"   - Query knowledge base for Remotion API, components, animations\n"
        f"   - Apply your creative choices\n"
        f"   - Call remotion_render tool with:\n"
        f"     - composition_code: your TSX (NO import statements) OR template: 'template_name'\n"
        f"     - clips: the video URLs array above\n"
        f"     - duration_seconds: {duration_seconds}\n"
        f"     - fps: 30\n"
        f"     - aspect_ratio: '9:16'\n\n"
        f"You have creative freedom - use templates or custom code as you see fit!\n"
        f"DO NOT just output code - you MUST call the remotion_render tool!"
    )


def build_publisher_prompt(*, project: str, video_url: str, topic: str | None) -> str:
    """Build the publisher prompt.

    The project config supports an optional `publisher_prompt_template` that can
    include `{video_url}` and `{topic}` placeholders.
    """
    template = load_project(project).publisher_prompt_template
    if template:
        try:
            rendered = template.format(video_url=video_url, topic=topic or "")
        except (KeyError, ValueError):
            rendered = ""
        if rendered.strip():
            prompt = rendered.strip()
            prompt += (
                "\n\nCRITICAL: Call upload_post tool to publish this video. "
                "Include a caption under 150 characters and 3-8 tags."
            )
            return prompt

    prompt = f"Publish this video: {video_url}"
    if topic:
        prompt += f"\n\nTopic: {topic}"

    prompt += (
        "\n\nCRITICAL: Call upload_post tool to publish this video. "
        "Include a caption under 150 characters and 3-8 tags."
    )
    return prompt
