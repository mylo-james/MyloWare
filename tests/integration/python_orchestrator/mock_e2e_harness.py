from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Sequence, cast

from langgraph.checkpoint.memory import MemorySaver

from adapters.ai_providers.kieai.fake import KieAIFakeClient
from adapters.ai_providers.shotstack.fake import ShotstackFakeClient
from adapters.social.upload_post.fake import UploadPostFakeClient
from apps.orchestrator import graph_factory, hitl_gate, persona_nodes, persona_tools
from apps.orchestrator.run_state import RunState


@dataclass
class InMemoryRunDB:
    run_id: str
    project: str
    videos: list[dict[str, Any]]

    artifacts: list[dict[str, Any]] = field(default_factory=list)
    status: str = "pending"
    publish_urls: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        self._run = {
            "run_id": self.run_id,
            "project": self.project,
            "status": self.status,
            "result": {
                "videos": [dict(video) for video in self.videos],
                "publishUrls": list(self.publish_urls),
            },
        }

    # Database interface --------------------------------------------------
    def get_run(self, run_id: str) -> dict[str, Any] | None:  # noqa: D401
        if run_id != self.run_id:
            return None
        return self._run

    def update_run(self, *, run_id: str, status: str, result: dict[str, Any] | None = None) -> None:  # noqa: D401
        if run_id != self.run_id:
            return
        self._run["status"] = status
        if result is not None:
            self._run["result"] = dict(result)

    def create_artifact(
        self,
        *,
        run_id: str,
        artifact_type: str,
        url: str | None,
        provider: str,
        checksum: str | None,
        metadata: dict[str, Any],
        persona: str | None = None,
    ) -> None:  # noqa: D401
        if run_id != self.run_id:
            return
        self.artifacts.append(
            {
                "run_id": run_id,
                "artifact_type": artifact_type,
                "url": url,
                "provider": provider,
                "checksum": checksum,
                "metadata": dict(metadata),
                "persona": persona,
            }
        )

    def list_artifacts(self, run_id: str) -> list[dict[str, Any]]:  # noqa: D401
        return [artifact for artifact in self.artifacts if artifact["run_id"] == run_id]

    # Helpers -------------------------------------------------------------
    def mark_videos_generated(self, *, asset_base: str) -> None:
        videos = self._run.setdefault("result", {}).setdefault("videos", [])
        for index, video in enumerate(videos):
            video["assetUrl"] = f"{asset_base}/{self.run_id}-{index}.mp4"
            video["status"] = "generated"
        self._run["result"]["videos"] = videos
        self._run["status"] = "generating"

    def mark_published(self, publish_url: str) -> None:
        self._run["status"] = "published"
        self._run.setdefault("result", {})["publishUrls"] = [publish_url]


class NoNetworkClient:  # pragma: no cover - used only if mistakenly instantiated
    def __init__(self, *_, **__):
        raise AssertionError("Network client should not be instantiated in mock E2E tests")


class MockPersonaFactory:
    def __init__(
        self,
        *,
        run_id: str,
        videos: list[dict[str, Any]],
        caption: str,
        db: InMemoryRunDB,
        executed: list[str],
    ) -> None:
        self.run_id = run_id
        self._videos = [dict(video) for video in videos]
        self._db = db
        self.caption = caption
        self._executed = executed

    def build(self, persona: str, project: str):  # type: ignore[no-untyped-def]
        persona_key = persona.lower()
        if persona_key == "iggy":
            return lambda state: self._iggy(state)
        if persona_key == "riley":
            return lambda state: self._riley(state)
        if persona_key == "alex":
            return lambda state: self._alex(state)
        if persona_key == "quinn":
            return lambda state: self._quinn(state)
        return lambda state: state

    def _append_history(self, state: RunState, persona: str, message: str) -> RunState:
        self._executed.append(persona)
        transcript = list(state.get("transcript", []))
        transcript.append(message)
        history = list(state.get("persona_history", []))
        history.append({"persona": persona, "message": message})
        updated = dict(state)
        updated["transcript"] = transcript
        updated["persona_history"] = history
        updated["current_persona"] = persona
        return cast(RunState, updated)

    def _iggy(self, state: RunState) -> RunState:
        storyboards: list[dict[str, Any]] = []
        for idx, video in enumerate(self._videos):
            concept = video.get("prompt") or video.get("subject") or f"Storyboard {idx}"
            storyboards.append(
                {
                    "index": video.get("index", idx),
                    "subject": video.get("subject"),
                    "header": video.get("header"),
                    "concept": concept,
                }
            )
        updated_videos = [dict(video) for video in self._videos]
        state = self._append_history(state, "iggy", "Storyboarded clips and handed off to Riley.")
        state.update({"videos": updated_videos, "storyboards": storyboards})
        return state

    def _riley(self, state: RunState) -> RunState:
        videos = state.get("videos") or [dict(video) for video in self._videos]
        payload = json.dumps(videos)
        persona_tools.submit_generation_jobs_tool(videos=payload, run_id=self.run_id)
        self._db.mark_videos_generated(asset_base="https://assets.mock")
        persona_tools.wait_for_generations_tool(
            run_id=self.run_id,
            expected_count=len(videos),
            timeout_minutes=0.05,
            poll_interval_seconds=0.01,
        )
        run = self._db.get_run(self.run_id) or {}
        generated_videos = [dict(video) for video in (run.get("result", {}).get("videos") or [])]
        scripts = [
            {
                "index": video.get("index", idx),
                "text": video.get("prompt") or video.get("header") or f"Clip {idx}",
                "durationSeconds": float(video.get("duration") or 8.0),
            }
            for idx, video in enumerate(generated_videos)
        ]
        state = self._append_history(state, "riley", "Drafted scripts and submitted kie.ai jobs.")
        state["scripts"] = scripts
        state["clips"] = generated_videos
        state["videos"] = generated_videos
        return state

    def _alex(self, state: RunState) -> RunState:
        clips = state.get("clips") or state.get("videos") or []
        persona_tools.render_video_timeline_tool(self.run_id, clips=clips)
        render_url = f"https://mock.video.myloware/{self.run_id}-final.mp4"
        renders = [
            {"index": clip.get("index", idx), "status": "rendered", "renderUrl": render_url}
            for idx, clip in enumerate(clips)
        ]
        state = self._append_history(state, "alex", "Rendered timeline and normalized output.")
        state["renders"] = renders
        state["render_url"] = render_url
        return state

    def _quinn(self, state: RunState) -> RunState:
        render_url = state.get("render_url")
        persona_tools.publish_to_tiktok_tool(caption=self.caption, run_id=self.run_id)
        publish_artifacts = [artifact for artifact in self._db.artifacts if artifact["artifact_type"] == "publish.url"]
        publish_url = publish_artifacts[-1]["url"] if publish_artifacts else f"https://publish.mock/{self.run_id}/video"
        self._db.mark_published(publish_url)
        state = self._append_history(state, "quinn", "Published to TikTok.")
        state["publishUrls"] = [publish_url]
        state["completed"] = True
        return state


class MockGraphHarness:
    def __init__(
        self,
        *,
        project: str,
        run_id: str,
        videos: list[dict[str, Any]],
        caption: str,
        prompt: str,
    ) -> None:
        self.project = project
        self.run_id = run_id
        self._videos = videos
        self.caption = caption
        self.prompt = prompt
        self.db = InMemoryRunDB(run_id, project, videos)
        self.executed_personas: list[str] = []
        self.tool_usage: dict[str, int] = defaultdict(int)

    def apply_patches(self, monkeypatch, tmp_path: Path) -> None:  # type: ignore[no-untyped-def]
        persona_tools._DB = self.db  # type: ignore[attr-defined]
        monkeypatch.setattr(persona_tools, "_get_db", lambda: self.db, raising=False)
        monkeypatch.setattr(persona_tools, "build_kieai_client", lambda settings, cache=None: KieAIFakeClient())
        monkeypatch.setattr(persona_tools, "build_shotstack_client", lambda settings, cache=None: ShotstackFakeClient())
        monkeypatch.setattr(persona_tools, "build_upload_post_client", lambda settings, cache=None: UploadPostFakeClient())
        monkeypatch.setattr(persona_tools.settings, "providers_mode", "mock", raising=False)
        persona_nodes._RUN_CLIENT = None  # type: ignore[attr-defined]
        monkeypatch.setattr(persona_nodes.httpx, "Client", NoNetworkClient, raising=False)
        local_video = tmp_path / f"{self.run_id}-local.mp4"
        local_video.write_bytes(b"video-bytes")
        monkeypatch.setattr(
            persona_tools,
            "_ensure_local_video_file",
            lambda source: (local_video, False),
            raising=False,
        )
        monkeypatch.setattr(
            persona_tools.httpx,
            "get",
            lambda *_, **__: (_ for _ in ()).throw(AssertionError("Network blocked")),
            raising=False,
        )

        def _wrap_tool(tool_name: str) -> None:
            original = getattr(persona_tools, tool_name)

            def _wrapper(*args, **kwargs):  # noqa: ANN001
                self.tool_usage[tool_name] += 1
                return original(*args, **kwargs)

            monkeypatch.setattr(persona_tools, tool_name, _wrapper, raising=False)

        for tool_name in (
            "submit_generation_jobs_tool",
            "wait_for_generations_tool",
            "render_video_timeline_tool",
            "publish_to_tiktok_tool",
        ):
            _wrap_tool(tool_name)

        factory = MockPersonaFactory(
            run_id=self.run_id,
            videos=self._videos,
            caption=self.caption,
            db=self.db,
            executed=self.executed_personas,
        )
        monkeypatch.setattr(persona_nodes, "create_persona_node", factory.build, raising=False)
        monkeypatch.setattr(graph_factory, "create_persona_node", factory.build, raising=False)

        def _auto_gate(state: RunState, gate_name: str) -> RunState:
            artifacts = list(state.get("artifacts", []))
            artifacts.append({"type": "hitl.request", "gate": gate_name, "persona": state.get("current_persona")})
            approvals = list(state.get("hitlApprovals", []))
            approvals.append({"gate": gate_name, "approved": True})
            updated = dict(state)
            updated["artifacts"] = artifacts
            updated["hitlApprovals"] = approvals
            updated["metadata"] = {**state.get("metadata", {}), f"{gate_name}_approved": True}
            updated["awaiting_gate"] = None
            return cast(RunState, updated)

        monkeypatch.setattr(hitl_gate, "hitl_gate_node", _auto_gate, raising=False)
        monkeypatch.setattr(graph_factory, "hitl_gate_node", _auto_gate, raising=False)

    def run_graph(self) -> RunState:
        spec = graph_factory.load_project_spec(self.project)
        graph = graph_factory.build_project_graph(spec, self.project)
        compiled = graph.compile(checkpointer=MemorySaver())
        initial_state: RunState = {
            "run_id": self.run_id,
            "project": self.project,
            "input": self.prompt,
            "videos": [dict(video) for video in self._videos],
            "metadata": {"project_spec": spec},
            "persona_history": [],
            "transcript": [],
            "artifacts": [],
        }
        result = cast(RunState, compiled.invoke(initial_state, config={"configurable": {"thread_id": self.run_id}}))
        # Ensure final state surfaces the run evidence tracked in the in-memory DB
        published = self.published_urls()
        if published:
            result = dict(result)
            result["publishUrls"] = published
        run_videos = self.run_videos()
        if run_videos:
            result = dict(result)
            result["videos"] = run_videos
        return cast(RunState, result)

    def artifact_types(self) -> set[str]:
        return {artifact["artifact_type"] for artifact in self.db.artifacts}

    def published_urls(self) -> list[str]:
        run = self.db.get_run(self.run_id) or {}
        return list(run.get("result", {}).get("publishUrls") or [])

    def run_videos(self) -> list[dict[str, Any]]:  # noqa: D401
        run = self.db.get_run(self.run_id) or {}
        return [dict(video) for video in run.get("result", {}).get("videos", [])]
