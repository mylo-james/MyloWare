"""upload-post fake adapter."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Sequence


@dataclass
class UploadPostFakeClient:
    """Deterministic fake publisher."""

    publishes: List[Dict[str, Any]] = field(default_factory=list)

    def publish(
        self,
        *,
        video_path: Path,
        caption: str,
        account_id: str | None = None,
        title: str | None = None,
        platforms: Sequence[str] | None = None,
    ) -> dict[str, Any]:
        run_id = video_path.stem if isinstance(video_path, Path) else "run"
        canonical_url = f"https://publish.mock/{run_id}/video"
        record = {
            "video_path": str(video_path),
            "caption": caption,
            "account_id": account_id,
            "title": title,
            "platforms": list(platforms) if platforms else None,
            "canonical_url": canonical_url,
        }
        self.publishes.append(record)
        return {"canonicalUrl": canonical_url, "status": "ok"}

    def close(self) -> None:
        return None
