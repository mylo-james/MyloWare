"""OpenAI Sora 2 video generation tool (fail-fast, no legacy-provider compatibility)."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Dict, List
from uuid import UUID

import httpx

from myloware.config import settings
from myloware.config.provider_modes import effective_sora_provider
from myloware.observability.logging import get_logger
from myloware.services.fake_sora import fake_sora_task_id_from_path, list_fake_sora_clips
from myloware.storage.database import get_session
from myloware.storage.models import ArtifactType
from myloware.storage.repositories import ArtifactRepository
from myloware.tools.base import JSONSchema, MylowareBaseTool, format_tool_success

logger = get_logger(__name__)

__all__ = ["SoraGenerationTool"]

_AISMR_GLOBAL_PROMPT_APPENDIX = (
    "GLOBAL CONSTRAINTS (AISMR): cinematic macro realism. "
    "AUDIO: NO MUSIC; NO BACKGROUND MUSIC; NO SCORE; no melody; no singing; no instruments. "
    "VO: whisper starts @3.00s exactly (frame 90 @30fps), with no voice before. "
    "VOICE PROFILE: soft breathy adult whisper, intimate close-mic, dry (no reverb), calm, consistent across clips."
)


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
            self.provider_mode = effective_sora_provider(settings)

        if self.provider_mode == "off":
            raise ValueError("Sora provider is disabled (SORA_PROVIDER=off)")

        self.use_fake = self.provider_mode == "fake"
        self.lightweight_fake = use_fake is True

        if self.provider_mode == "real" and not self.api_key:
            raise ValueError("OpenAI API key required when SORA_PROVIDER=real")

        # OpenAI Sora uses Standard Webhooks configured in the dashboard; per-request callback_url
        # is not supported. Ensure a public webhook endpoint is configured out-of-band.
        if self.provider_mode == "real" and not self.callback_url:
            logger.warning(
                "WEBHOOK_BASE_URL missing; Sora webhooks are configured in the OpenAI dashboard. "
                "Ensure a public /v1/webhooks/sora endpoint is registered."
            )

        logger.info(
            "SoraGenerationTool initialized (run_id=%s, mode=%s, webhook_configured=%s)",
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
        # Preserve list order so idempotency is clip-order sensitive.
        key_data = {
            "run_id": self.run_id,
            "videos": [json.dumps(v, sort_keys=True) for v in videos],
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
        from myloware.storage import database as db

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

        from myloware.storage import database as db

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
                        "'voice_over' (optional script), and optional cache metadata: 'topic', 'sign', 'object_name'. "
                        "For partial retries, you may also include an explicit 'video_index' (0-based)."
                    ),
                    "items": {
                        "type": "object",
                        "properties": {
                            "visual_prompt": {"type": "string"},
                            "voice_over": {"type": "string"},
                            "topic": {"type": "string"},
                            "sign": {"type": "string"},
                            "object_name": {"type": "string"},
                            "video_index": {
                                "type": "integer",
                                "description": (
                                    "Optional absolute index (0-based) for this clip. "
                                    "Use this when re-submitting a subset so clip ordering stays stable."
                                ),
                            },
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

    @staticmethod
    def _coerce_video_index(video: Dict[str, Any], fallback: int) -> int:
        raw = (
            video.get("video_index")
            or video.get("videoIndex")
            or video.get("idx")
            or video.get("index")
            or fallback
        )
        try:
            return int(raw)
        except Exception:
            return fallback

    async def _store_submission_request_async(
        self,
        *,
        videos: List[Dict[str, str]],
        aspect_ratio: str,
        n_frames: str | int,
        remove_watermark: bool,
        idempotency_key: str | None,
    ) -> None:
        """Store the Sora submission payload so we can re-submit only failed clips later."""
        # Store request payloads only for real runs (paid) so we can safely
        # re-submit a subset without involving the agent again.
        if (
            not self.run_id
            or getattr(settings, "disable_background_workflows", False)
            or self.provider_mode != "real"
        ):
            return

        try:
            normalized_videos: list[dict[str, Any]] = []
            for idx, video in enumerate(videos):
                normalized_videos.append(
                    {
                        "video_index": self._coerce_video_index(video, idx),
                        "visual_prompt": video.get("visual_prompt", ""),
                        "voice_over": video.get("voice_over", ""),
                        "topic": video.get("topic", ""),
                        "sign": video.get("sign", ""),
                        "object_name": video.get("object_name", ""),
                    }
                )

            payload = {
                "model": self.model,
                "videos": normalized_videos,
                "aspect_ratio": aspect_ratio,
                "n_frames": str(n_frames),
                "remove_watermark": bool(remove_watermark),
            }

            from myloware.storage import database as db

            SessionLocal = db.get_async_session_factory()
            async with SessionLocal() as session:
                repo = ArtifactRepository(session)
                metadata: dict[str, Any] = {
                    "type": "sora_submission_request",
                    "task_count": len(normalized_videos),
                }
                if idempotency_key:
                    metadata["idempotency_key"] = idempotency_key

                await repo.create_async(
                    run_id=UUID(self.run_id),
                    persona="producer",
                    artifact_type=ArtifactType.SORA_REQUEST,
                    content=json.dumps(payload),
                    metadata=metadata,
                )
                await session.commit()
        except Exception as exc:  # pragma: no cover - best-effort durability aid
            logger.warning("Failed to store Sora submission request: %s", exc)

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
            # Duration token (seconds), not a credential.
            seconds_token = "8"  # nosec B105

        task_ids: list[str] = []
        task_metadata: dict[str, dict[str, Any]] = {}

        await self._store_submission_request_async(
            videos=videos,
            aspect_ratio=aspect_ratio,
            n_frames=n_frames,
            remove_watermark=True,
            idempotency_key=idempotency_key or None,
        )

        for idx, (video, clip_path) in enumerate(zip(videos, clip_paths, strict=False)):
            video_index = self._coerce_video_index(video, idx)
            task_id = self._task_id_from_path(clip_path, idx)
            task_ids.append(task_id)
            meta: dict[str, Any] = {
                "video_index": video_index,
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
            for idx, (video, clip_path) in enumerate(zip(videos, clip_paths, strict=False)):
                await self._post_fake_completion_webhook(
                    task_ids[idx],
                    self._coerce_video_index(video, idx),
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
        clip_paths = list_fake_sora_clips()
        if not clip_paths:
            clips_dir = Path(
                getattr(settings, "sora_fake_clips_dir", "fake_clips/sora")
            ).expanduser()
            raise ValueError(
                f"SORA_PROVIDER=fake but no fake clips found. Looked in: {clips_dir} and repo root (video*.mp4). "
                "Set SORA_FAKE_CLIPS_DIR or SORA_FAKE_CLIP_PATHS."
            )

        if len(clip_paths) < required_count:
            raise ValueError(
                f"Not enough fake Sora clips. Needed {required_count}, found {len(clip_paths)}."
            )
        return clip_paths[:required_count]

    @staticmethod
    def _task_id_from_path(path: Path, idx: int) -> str:
        return fake_sora_task_id_from_path(path, idx)

    async def _post_fake_completion_webhook(
        self,
        task_id: str,
        video_index: int,
    ) -> None:
        """Post an OpenAI Standard Webhooks event for video completion.

        OpenAI's expected contract is an event envelope:
          {"object":"event","type":"video.completed","data":{"id":"video_..."}}
        """
        import time

        base = getattr(settings, "webhook_base_url", "") or f"http://localhost:{settings.api_port}"
        webhook_url = f"{base.rstrip('/')}/v1/webhooks/sora"

        event_id = f"evt_fake_{task_id}"
        created_at = int(time.time())
        payload = {
            "id": event_id,
            "object": "event",
            "created_at": created_at,
            "type": "video.completed",
            "data": {"id": task_id, "videoIndex": video_index},
        }

        body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")

        # In fake mode, server-side signature verification is skipped. Still send the
        # standard headers so the request shape matches production.
        headers: dict[str, str] = {
            "Content-Type": "application/json",
            "webhook-id": event_id,
            "webhook-timestamp": str(created_at),
            "webhook-signature": "v1,fake",
        }

        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(webhook_url, content=body, headers=headers)
            resp.raise_for_status()

        logger.info(
            "Posted fake OpenAI video.completed webhook (run=%s, task=%s, idx=%s)",
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
        stop_error: str | None = None

        await self._store_submission_request_async(
            videos=videos,
            aspect_ratio=aspect_ratio,
            n_frames=n_frames,
            remove_watermark=remove_watermark,
            idempotency_key=idempotency_key or None,
        )

        workflow_name = await self._get_run_workflow_name_async()
        task_ids, task_metadata, stop_error = await self._submit_openai_videos(
            videos=videos,
            aspect_ratio=aspect_ratio,
            n_frames=n_frames,
            workflow_name=workflow_name,
        )

        # Persist whatever we submitted so webhooks can be validated/ingested even if we stop early.
        if self.run_id and task_metadata:
            await self._store_task_metadata_async(task_metadata, idempotency_key=idempotency_key)

        if stop_error:
            submitted = len(task_ids)
            raise ValueError(
                f"Sora submission failed after {submitted}/{len(videos)} tasks. {stop_error}"
            )

        if not task_ids:
            raise ValueError("Failed to submit any tasks")

        logger.info(
            "Submitted %s/%s Sora 2 tasks (dashboard webhooks)",
            len(task_ids),
            len(videos),
        )

        result = {
            "task_ids": task_ids,
            "task_metadata": task_metadata,
            "status": "submitted",
            "model": self.model,
            "task_count": len(task_ids),
            "run_id": self.run_id,
            "message": "Videos are delivered via OpenAI Standard Webhooks (video.completed/video.failed)",
        }

        return format_tool_success(
            result,
            message=f"Submitted {len(task_ids)} Sora 2 video tasks (voice over enabled)",
        )

    async def _submit_openai_videos(
        self,
        *,
        videos: List[Dict[str, str]],
        aspect_ratio: str,
        n_frames: str | int,
        workflow_name: str | None = None,
    ) -> tuple[list[str], dict[str, dict[str, Any]], str | None]:
        """Submit video generation jobs to OpenAI and return (task_ids, task_metadata).

        This helper does not persist any artifacts; callers must store task metadata for
        webhook validation/resume.
        """
        task_ids: list[str] = []
        task_metadata: dict[str, dict[str, Any]] = {}
        stop_error: str | None = None

        is_aismr = workflow_name == "aismr"

        ar = aspect_ratio.lower()
        size = "1280x720" if ar in {"landscape", "16:9", "16/9", "horizontal"} else "720x1280"

        seconds_token = str(n_frames)
        if seconds_token not in {"4", "8", "12"}:
            # Duration token (seconds), not a credential.
            seconds_token = "8"  # nosec B105

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        async with httpx.AsyncClient(timeout=self.timeout) as _client:
            for idx, video in enumerate(videos):
                video_index = self._coerce_video_index(video, idx)
                visual_prompt = video.get("visual_prompt", "")
                voice_over = video.get("voice_over", "")

                full_prompt = visual_prompt
                if voice_over:
                    full_prompt = f'{visual_prompt}\n\nVoice over narration: "{voice_over}"'

                if is_aismr and "GLOBAL CONSTRAINTS (AISMR)" not in full_prompt:
                    full_prompt = f"{full_prompt}\n\n{_AISMR_GLOBAL_PROMPT_APPENDIX}"

                logger.debug(
                    "Submitting OpenAI video job %s/%s (model=%s)",
                    idx + 1,
                    len(videos),
                    self.model,
                )

                payload = {
                    "model": self.model,
                    "prompt": full_prompt,
                    "seconds": seconds_token,
                    "size": size,
                }

                try:
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
                        "video_index": video_index,
                        "size": size,
                        "seconds": seconds_token,
                    }
                    for key in ("topic", "sign", "object_name"):
                        if video.get(key):
                            task_metadata[task_id][key] = video[key]

                    logger.info(
                        "OpenAI video task submitted: %s (dashboard webhook expected)",
                        task_id,
                    )
                except Exception as exc:
                    # Fail-fast: stop submitting further clips to avoid surprise costs.
                    stop_error = f"Video {idx + 1}/{len(videos)}: {type(exc).__name__} - {exc}"
                    logger.error("OpenAI video submission failed (fail-fast): %s", stop_error)
                    break

        return task_ids, task_metadata, stop_error

    async def _get_run_workflow_name_async(self) -> str | None:
        """Async lookup of the workflow name for this run.

        Used to apply project-specific prompt hardening (e.g., AISMR audio rules)
        without blocking the event loop.
        """
        if not self.run_id:
            return None

        try:
            run_uuid = UUID(self.run_id)
        except Exception:
            return None

        try:
            from myloware.storage import database as db
            from myloware.storage.repositories import RunRepository

            SessionLocal = db.get_async_session_factory()
            async with SessionLocal() as session:
                run = await RunRepository(session).get_async(run_uuid)
                return getattr(run, "workflow_name", None) if run else None
        except Exception:
            return None
