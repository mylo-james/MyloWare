from __future__ import annotations

from pathlib import Path

from myloware.config.settings import settings


def fake_sora_task_id_from_path(path: Path, idx: int) -> str:
    stem = path.stem
    if stem.startswith("video_"):
        return stem
    # Deterministic id so callers can resolve task_id -> path without state.
    import hashlib

    digest = hashlib.sha256(f"{stem}:{idx}".encode()).hexdigest()[:32]
    return f"video_{digest}"


def list_fake_sora_clips() -> list[Path]:
    explicit_paths = getattr(settings, "sora_fake_clip_paths", []) or []
    if explicit_paths:
        return [Path(p).expanduser().resolve() for p in explicit_paths]

    # Dev convenience: allow MP4s in repo root (preferred when present so you can
    # drop in "video*_test.mp4" fixtures without touching config).
    root = Path.cwd()
    root_test = sorted((p.resolve() for p in root.glob("video*_test.mp4")))
    if root_test:
        return root_test

    clips_dir = Path(getattr(settings, "sora_fake_clips_dir", "fake_clips/sora")).expanduser()
    if clips_dir.exists():
        return sorted((p.resolve() for p in clips_dir.glob("*.mp4")))

    return sorted((p.resolve() for p in root.glob("video*.mp4")))


def resolve_fake_sora_clip(task_id: str) -> Path | None:
    for idx, path in enumerate(list_fake_sora_clips()):
        if fake_sora_task_id_from_path(path, idx) == task_id:
            return path
    return None
