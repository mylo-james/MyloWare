"""OpenAI Sora 2 video generation tool (fail-fast, no legacy-provider compatibility)."""

from __future__ import annotations

import hashlib
import hmac
import json
from pathlib import Path
from typing import Any, Dict, List
from uuid import UUID

import httpx

from config import settings
from observability.logging import get_logger
from storage.database import get_session
from storage.models import ArtifactType
from storage.repositories import ArtifactRepository
from tools.base import MylowareBaseTool, JSONSchema, format_tool_success

logger = get_logger(__name__)

__all__ = ["SoraGenerationTool"]


class SoraGenerationTool(MylowareBaseTool):
    """Generate video clips using OpenAI Sora 2 (text-to-video)."""

    def __init__(
        self,
        run_id: str | None = None,
        api_key: str | None = None,
        model: str | None = None,
        timeout: float = 60.0,
        use_fake: bool | None = None,
    ):
        super().__init__()
        self.run_id = run_id
        self.api_key = api_key or getattr(settings, "openai_api_key", None)
        self.model = model or "sora-2"
        self.timeout = timeout

        webhook_base = getattr(settings, "webhook_base_url", "")
        self.callback_url = (
            f"{webhook_base}/v1/webhooks/sora?run_id={run_id}" if webhook_base and run_id else None
        )

        # Provider selection (fail-fast, no silent fallbacks)
        provider_setting_raw = getattr(settings, "sora_provider", "real")
        provider_setting = (
            provider_setting_raw.lower() if isinstance(provider_setting_raw, str) else None
        )
        if provider_setting and provider_setting not in {"real", "fake", "off"}:
            raise ValueError(f"Invalid SORA_PROVIDER value: {provider_setting_raw}")
        if use_fake is not None:
            self.provider_mode = "fake" if use_fake else "real"
        else:
            self.provider_mode = provider_setting or "real"

        if self.provider_mode == "off":
            raise ValueError("Sora provider is disabled (SORA_PROVIDER=off)")

        self.use_fake = self.provider_mode == "fake"
        self.lightweight_fake = use_fake is True

        if self.provider_mode == "real" and not self.api_key:
            raise ValueError("OpenAI API key required when SORA_PROVIDER=real")

        # Webhook callbacks are recommended, but the current OpenAI Videos API (openai>=2.9.0)
        # does not accept callback_url. Log a warning instead of failing hard so we can fall back
        # to polling / manual retrieval in a later step.
        if self.provider_mode == "real" and not self.callback_url:
            logger.warning(
                "WEBHOOK_BASE_URL missing; proceeding without per-request callback (OpenAI videos API "
                "no longer accepts callback_url). Jobs will require polling or a dashboard-level webhook."
            )

        logger.info(
            "SoraGenerationTool initialized (run_id=%s, mode=%s, callback=%s)",
            self.run_id,
            self.provider_mode,
            bool(self.callback_url),
        )

    def _store_task_metadata_sync(
        self, task_metadata: Dict[str, Dict[str, Any]], idempotency_key: str | None = None
    ) -> None:
        """Sync fallback for task metadata storage.

        Args:
            task_metadata: Mapping of task_id to metadata
            idempotency_key: Optional idempotency key to store for replay detection
        """
        if not self.run_id:
            logger.warning("Cannot store task metadata: no run_id")
            return

        with get_session() as session:
            repo = ArtifactRepository(session)
            metadata = {
                "type": "task_metadata_mapping",
                "task_count": len(task_metadata),
            }
            if idempotency_key:
                metadata["idempotency_key"] = idempotency_key

            repo.create(
                run_id=UUID(self.run_id),
                persona="producer",
                artifact_type=ArtifactType.CLIP_MANIFEST,
                content=json.dumps(task_metadata),
                metadata=metadata,
            )
            session.commit()
        logger.info("Stored task metadata mapping for %d tasks (sync)", len(task_metadata))

    def _compute_idempotency_key(
        self, videos: List[Dict[str, str]], aspect_ratio: str, n_frames: str | int
    ) -> str:
        """Compute idempotency key from run_id + hash(videos + params).

        Args:
            videos: List of video specifications
            aspect_ratio: Aspect ratio parameter
            n_frames: Number of frames parameter

        Returns:
            Hex digest of the idempotency key
        """
        if not self.run_id:
            return ""

        # Create deterministic hash from run_id + videos + params
        key_data = {
            "run_id": self.run_id,
            "videos": sorted([json.dumps(v, sort_keys=True) for v in videos]),
            "aspect_ratio": aspect_ratio,
            "n_frames": str(n_frames),
        }
        key_str = json.dumps(key_data, sort_keys=True)
        return hashlib.sha256(key_str.encode()).hexdigest()

    async def _check_existing_submission(self, idempotency_key: str) -> Dict[str, Any] | None:
        """Check if we've already submitted this exact request.

        Args:
            idempotency_key: The computed idempotency key

        Returns:
            Existing task_ids if found, None otherwise
        """
        if not self.run_id or not idempotency_key:
            return None

        # Use runtime import so tests can monkeypatch storage.database.get_async_session_factory
        from storage import database as db

        SessionLocal = db.get_async_session_factory()
        async with SessionLocal() as session:
            repo = ArtifactRepository(session)
            try:
                run_uuid = UUID(self.run_id)
            except (ValueError, TypeError):
                logger.warning(
                    "Skipping idempotency check: run_id is not a valid UUID: %s", self.run_id
                )
                return None

            artifacts = await repo.get_by_run_async(run_uuid)

            # Look for CLIP_MANIFEST with matching idempotency_key
            for artifact in artifacts:
                if (
                    artifact.artifact_type == ArtifactType.CLIP_MANIFEST.value
                    and artifact.artifact_metadata
                    and artifact.artifact_metadata.get("idempotency_key") == idempotency_key
                ):
                    # Found existing submission - return task_ids
                    try:
                        task_metadata = json.loads(artifact.content or "{}")
                        task_ids = list(task_metadata.keys())
                        logger.info(
                            "Found existing Sora submission with idempotency_key=%s, returning %d task_ids",
                            idempotency_key[:16],
                            len(task_ids),
                        )
                        return {
                            "task_ids": task_ids,
                            "task_metadata": task_metadata,
                            "from_cache": True,
                        }
                    except Exception as e:
                        logger.warning("Failed to parse existing submission: %s", e)
                        return None

        return None

    async def _store_task_metadata_async(
        self, task_metadata: Dict[str, Dict[str, Any]], idempotency_key: str | None = None
    ) -> None:
        """Async store task_id -> cache metadata mapping for webhook lookup.

        Args:
            task_metadata: Mapping of task_id to metadata
            idempotency_key: Optional idempotency key to store for replay detection
        """
        if not self.run_id:
            logger.warning("Cannot store task metadata: no run_id")
            return

        from storage import database as db

        SessionLocal = db.get_async_session_factory()
        async with SessionLocal() as session:
            repo = ArtifactRepository(session)
            metadata = {
                "type": "task_metadata_mapping",
                "task_count": len(task_metadata),
            }
            if idempotency_key:
                metadata["idempotency_key"] = idempotency_key

            await repo.create_async(
                run_id=UUID(self.run_id),
                persona="producer",
                artifact_type=ArtifactType.CLIP_MANIFEST,
                content=json.dumps(task_metadata),
                metadata=metadata,
            )
            await session.commit()
        logger.info("Stored task metadata mapping for %d tasks", len(task_metadata))

    def get_name(self) -> str:
        return "sora_generate"

    def get_description(self) -> str:
        return (
            "Generate short video clips using OpenAI Sora 2 text-to-video. "
            "Provide visual prompts (and optional voice-over context) for each clip. "
            "Results are delivered by posting to /v1/webhooks/sora after render completes."
        )

    def get_input_schema(self) -> JSONSchema:
        return {
            "type": "object",
            "properties": {
                "videos": {
                    "type": "array",
                    "description": (
                        "List of video specifications. Each video is an object with 'visual_prompt' (required), "
                        "'voice_over' (optional script), and optional cache metadata: 'topic', 'sign', 'object_name'."
                    ),
                    "items": {
                        "type": "object",
                        "properties": {
                            "visual_prompt": {"type": "string"},
                            "voice_over": {"type": "string"},
                            "topic": {"type": "string"},
                            "sign": {"type": "string"},
                            "object_name": {"type": "string"},
                        },
                        "required": ["visual_prompt"],
                    },
                },
                "aspect_ratio": {
                    "type": "string",
                    "description": "Aspect ratio. Accepts '9:16', '16:9', 'portrait', 'landscape'. Default: 9:16 (portrait).",
                    "default": "9:16",
                },
                "n_frames": {
                    "type": ["string", "number"],
                    "description": "Video duration (seconds) for Sora 2. Allowed: 4, 8, 12. Default: 8.",
                    "default": "8",
                },
                "remove_watermark": {
                    "type": "boolean",
                    "description": "Whether to request watermark removal (Sora default: true).",
                    "default": True,
                },
            },
            "required": ["videos"],
        }

    def _validate_result(self, result: Dict[str, Any]) -> Dict[str, Any]:
        task_count = result.get("task_count")
        if not isinstance(task_count, int) or task_count <= 0:
            raise ValueError("task_count must be a positive integer")
        if self.run_id and result.get("run_id") and str(result.get("run_id")) != str(self.run_id):
            raise ValueError("run_id mismatch in Sora result")
        return result

    async def async_run_impl(
        self,
        videos: List[Dict[str, str]] | None = None,
        aspect_ratio: str = "9:16",
        n_frames: str | int = "8",
        remove_watermark: bool = True,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        """Submit video generation jobs to OpenAI Sora 2."""
        if not videos:
            raise ValueError("'videos' parameter required")

        logger.info(
            "Submitting %s Sora video generation jobs (model=%s, run_id=%s)",
            len(videos),
            self.model,
            self.run_id,
        )

        if self.provider_mode == "fake":
            return await self._run_fake(videos, aspect_ratio, n_frames)
        if self.provider_mode == "real":
            return await self._run_real(
            videos=videos,
            aspect_ratio=aspect_ratio,
            n_frames=n_frames,
            remove_watermark=remove_watermark,
        )
        raise ValueError(f"Unsupported Sora provider mode: {self.provider_mode}")

    async def _run_fake(
        self,
        videos: List[Dict[str, str]],
        aspect_ratio: str,
        n_frames: str | int,
    ) -> Dict[str, Any]:
        """Contract-exact fake provider.

        Uses local MP4 fixtures, stores clip_manifest metadata, and posts real
        /v1/webhooks/sora completion callbacks so the workflow proceeds exactly
        as in production. No DB/checkpointer shortcuts.
        """

        # In explicit lightweight fake or test mode, avoid filesystem/network deps.
        if self.lightweight_fake or getattr(settings, "disable_background_workflows", False):
            lightweight_task_ids = [f"fake-sora-task-{i}" for i in range(len(videos))]
            logger.info(
                "Fake Sora 2 (lightweight): Submitted %s fake tasks", len(lightweight_task_ids)
            )
            return format_tool_success(
                {
                    "task_ids": lightweight_task_ids,
                    "status": "submitted",
                    "model": self.model,
                    "task_count": len(lightweight_task_ids),
                    "run_id": self.run_id,
                    "fake_mode": True,
                    "n_frames": str(n_frames),
                    "aspect_ratio": aspect_ratio,
                    "message": "Videos will be delivered via webhook when ready",
                },
                message=f"Submitted {len(lightweight_task_ids)} Sora 2 video generation tasks",
            )

        # Idempotency: if identical request already submitted, reuse task_ids.
        idempotency_key = self._compute_idempotency_key(videos, aspect_ratio, n_frames)
        if idempotency_key:
            existing = await self._check_existing_submission(idempotency_key)
            if existing:
                return format_tool_success(
                    {
                        "task_ids": existing["task_ids"],
                        "task_metadata": existing["task_metadata"],
                        "status": "submitted",
                        "model": self.model,
                        "task_count": len(existing["task_ids"]),
                        "run_id": self.run_id,
                        "fake_mode": True,
                        "idempotent": True,
                        "message": "Returned existing fake task_ids (idempotent replay)",
                    },
                    message=f"Returned {len(existing['task_ids'])} existing fake Sora task_ids (idempotent)",
                )

        clip_paths = self._load_fake_clips(len(videos))

        ar = aspect_ratio.lower()
        size = "1280x720" if ar in {"landscape", "16:9", "16/9", "horizontal"} else "720x1280"
        seconds_token = str(n_frames)
        if seconds_token not in {"4", "8", "12"}:
            seconds_token = "8"

        task_ids: list[str] = []
        task_metadata: dict[str, dict[str, Any]] = {}

        for idx, (video, clip_path) in enumerate(zip(videos, clip_paths, strict=False)):
            task_id = self._task_id_from_path(clip_path, idx)
            task_ids.append(task_id)
            meta: dict[str, Any] = {
                "video_index": idx,
                "size": size,
                "seconds": seconds_token,
            }
            for key in ("topic", "sign", "object_name"):
                if video.get(key):
                    meta[key] = video[key]
            task_metadata[task_id] = meta

        if self.run_id and task_metadata:
            await self._store_task_metadata_async(task_metadata, idempotency_key=idempotency_key)

        # Post completion webhooks immediately.
        #
        # Important: tools are executed inside the sync Agent tool bridge, which may run
        # this coroutine in a short-lived event loop. Using create_task() would schedule
        # work that never runs once the loop is closed, leaving runs stuck awaiting videos.
        if self.run_id and not getattr(settings, "disable_background_workflows", False):
            for idx, clip_path in enumerate(clip_paths):
                file_url = clip_path.as_uri()
                await self._post_fake_completion_webhook(
                    task_ids[idx],
                    idx,
                    file_url,
                )

        logger.info("Fake Sora 2: Submitted %s fake tasks", len(task_ids))
        return format_tool_success(
            {
                "task_ids": task_ids,
                "task_metadata": task_metadata,
                "status": "submitted",
                "model": self.model,
                "task_count": len(task_ids),
                "run_id": self.run_id,
                "fake_mode": True,
                "n_frames": seconds_token,
                "aspect_ratio": aspect_ratio,
                "message": "Videos will be delivered via webhook when ready",
            },
            message=f"Submitted {len(task_ids)} Sora 2 video generation tasks",
        )

    def _load_fake_clips(self, required_count: int) -> list[Path]:
        """Load MP4 fixtures for fake provider."""
        explicit_paths = getattr(settings, "sora_fake_clip_paths", []) or []
        if explicit_paths:
            clip_paths = [Path(p).expanduser().resolve() for p in explicit_paths]
        else:
            clips_dir = Path(getattr(settings, "sora_fake_clips_dir", "fake_clips/sora")).expanduser()
            if not clips_dir.exists():
                raise ValueError(
                    f"SORA_PROVIDER=fake but fake clips dir not found: {clips_dir}. "
                    "Set SORA_FAKE_CLIPS_DIR or SORA_FAKE_CLIP_PATHS."
                )
            clip_paths = sorted((p.resolve() for p in clips_dir.glob("*.mp4")))

        if len(clip_paths) < required_count:
            raise ValueError(
                f"Not enough fake Sora clips. Needed {required_count}, found {len(clip_paths)}."
            )
        return clip_paths[:required_count]

    @staticmethod
    def _task_id_from_path(path: Path, idx: int) -> str:
        stem = path.stem
        if stem.startswith("video_"):
            return stem
        digest = hashlib.sha256(f"{stem}:{idx}".encode()).hexdigest()[:32]
        return f"video_{digest}"

    async def _post_fake_completion_webhook(
        self,
        task_id: str,
        video_index: int,
        file_url: str,
    ) -> None:
        """Post a Sora completion webhook identical to production schema."""
        base = getattr(settings, "webhook_base_url", "") or f"http://localhost:{settings.api_port}"
        webhook_url = f"{base.rstrip('/')}/v1/webhooks/sora?run_id={self.run_id}"

        payload = {
            "code": 200,
            "msg": "success",
            "data": {
                "taskId": task_id,
                "state": "success",
                "resultJson": json.dumps({"resultUrls": [file_url]}),
                "info": {"resultUrls": [file_url]},
                "metadata": {"videoIndex": video_index},
            },
        }

        body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")

        secret = (
            getattr(settings, "openai_sora_signing_secret", None)
            or getattr(settings, "openai_standard_webhook_secret", None)
            or ""
        )
        headers: dict[str, str] = {"Content-Type": "application/json"}
        if secret:
            digest = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
            headers["webhook-signature"] = f"sha256={digest}"

        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(webhook_url, content=body, headers=headers)
            resp.raise_for_status()
        logger.info(
            "Posted fake Sora completion webhook (run=%s, task=%s, idx=%s)",
            self.run_id,
            task_id,
            video_index,
        )

    async def _run_real(
        self,
        videos: List[Dict[str, str]],
        aspect_ratio: str,
        n_frames: str | int,
        remove_watermark: bool,
    ) -> Dict[str, Any]:
        """Submit real jobs to OpenAI Sora 2 API and post back to webhook.

        Implements idempotency: if the same request (run_id + hash(videos)) was already
        submitted, returns existing task_ids instead of re-submitting.
        """

        # Check for existing submission (idempotency)
        idempotency_key = self._compute_idempotency_key(videos, aspect_ratio, n_frames)
        if idempotency_key:
            existing = await self._check_existing_submission(idempotency_key)
            if existing:
                logger.info(
                    "Sora submission is idempotent (key=%s), returning existing task_ids",
                    idempotency_key[:16],
                )
                return format_tool_success(
                    {
                        "task_ids": existing["task_ids"],
                        "task_metadata": existing["task_metadata"],
                        "status": "submitted",
                        "model": self.model,
                        "task_count": len(existing["task_ids"]),
                        "run_id": self.run_id,
                        "idempotent": True,
                        "message": "Returned existing task_ids (idempotent replay)",
                    },
                    message=f"Returned {len(existing['task_ids'])} existing Sora task_ids (idempotent)",
                )

        task_ids: List[str] = []
        task_metadata: Dict[str, Dict[str, Any]] = {}
        errors: List[str] = []

        async with httpx.AsyncClient(timeout=self.timeout) as _client:
            for idx, video in enumerate(videos):
                visual_prompt = video.get("visual_prompt", "")
                voice_over = video.get("voice_over", "")

                full_prompt = visual_prompt
                if voice_over:
                    full_prompt = f'{visual_prompt}\n\nVoice over narration: "{voice_over}"'

                logger.debug(
                    "Submitting OpenAI video job %s/%s (model=%s)", idx + 1, len(videos), self.model
                )

                metadata = {
                    "runId": self.run_id,
                    "videoIndex": idx,
                    "hasVoiceOver": bool(voice_over),
                }
                for key in ("topic", "sign", "object_name"):
                    if video.get(key):
                        metadata[key] = video[key]

                ar = aspect_ratio.lower()
                size = (
                    "1280x720" if ar in {"landscape", "16:9", "16/9", "horizontal"} else "720x1280"
                )

                seconds_token = str(n_frames)
                if seconds_token not in {"4", "8", "12"}:
                    seconds_token = "8"

                payload = {
                    "model": self.model,
                    "prompt": full_prompt,
                    "seconds": seconds_token,
                    "size": size,
                }
                # Try to send callback_url if we have one; if API rejects, fall back without it.
                if self.callback_url:
                    payload["callback_url"] = self.callback_url

                headers = {
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                }

                try:
                    resp = await _client.post(
                        "https://api.openai.com/v1/videos", json=payload, headers=headers
                    )
                    if resp.status_code == 400 and "callback_url" in payload:
                        # Retry without callback_url if server rejects it
                        logger.warning(
                            "Videos API rejected callback_url, retrying without it: %s",
                            resp.text[:200],
                        )
                        payload.pop("callback_url", None)
                        resp = await _client.post(
                            "https://api.openai.com/v1/videos", json=payload, headers=headers
                        )

                    resp.raise_for_status()
                    submit = resp.json()
                    task_id = submit.get("id")
                    if not task_id:
                        raise ValueError(f"No task id in response: {submit}")

                    task_ids.append(task_id)
                    task_metadata[task_id] = {
                        "video_index": idx,
                        "size": size,
                        "seconds": seconds_token,
                        **{
                            k: v
                            for k, v in metadata.items()
                            if k not in {"runId", "videoIndex", "hasVoiceOver"}
                        },
                    }
                    logger.info(
                        "OpenAI video task submitted: %s (callback sent=%s)",
                        task_id,
                        self.callback_url,
                    )

                except Exception as e:
                    error_msg = f"Video {idx}: {type(e).__name__} - {str(e)}"
                    errors.append(error_msg)
                    logger.warning(error_msg)

        if not task_ids:
            raise ValueError(f"Failed to submit any tasks: {errors}")

        logger.info(
            "Submitted %s/%s Sora 2 tasks (no callback_url param sent)",
            len(task_ids),
            len(videos),
        )

        if self.run_id and task_metadata:
            await self._store_task_metadata_async(task_metadata, idempotency_key=idempotency_key)

        result = {
            "task_ids": task_ids,
            "task_metadata": task_metadata,
            "status": "submitted",
            "model": self.model,
            "task_count": len(task_ids),
            "run_id": self.run_id,
            "message": "Videos with voice over will be delivered via webhook when ready",
        }

        if errors:
            result["errors"] = errors
            result["partial_success"] = True

        return format_tool_success(
            result,
            message=f"Submitted {len(task_ids)} Sora 2 video tasks (voice over enabled)",
        )
