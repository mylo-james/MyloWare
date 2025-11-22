from __future__ import annotations

import json
import threading
from hashlib import sha256
from pathlib import Path
from typing import Any, Mapping


class ResponseCache:
    """Filesystem-backed cache for provider responses."""

    def __init__(self, base_dir: str | Path) -> None:
        self._base = Path(base_dir).expanduser()
        self._base.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    def get(self, namespace: str, key: Mapping[str, Any]) -> dict[str, Any] | None:
        path = self._path(namespace, key)
        if not path.exists():
            return None
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)

    def set(self, namespace: str, key: Mapping[str, Any], value: Mapping[str, Any]) -> None:
        path = self._path(namespace, key)
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = json.dumps(value, sort_keys=True)
        tmp_path = path.with_suffix(".json.tmp")
        with self._lock:
            with tmp_path.open("w", encoding="utf-8") as handle:
                handle.write(payload)
            tmp_path.replace(path)

    def _path(self, namespace: str, key: Mapping[str, Any]) -> Path:
        serialized = json.dumps(key, sort_keys=True, separators=(",", ":"))
        digest = sha256(serialized.encode("utf-8")).hexdigest()
        return self._base / namespace / f"{digest}.json"
