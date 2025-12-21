"""
Developer-friendly e2e runner.

Default mode uses the in-process FastAPI app (ASGITransport) with:
- sqlite+aiosqlite scratch DB
- fake providers
- background workflows disabled (we drive progress via webhooks)

You can also point at a running server with --base-url to exercise the same flow
end-to-end (webhooks included).
"""

from __future__ import annotations

import argparse
import anyio
import json
from uuid import UUID

from httpx import ASGITransport, AsyncClient

from myloware.api.server import app
from myloware.config import settings
from myloware.storage.database import get_async_session_factory, init_async_db
from myloware.storage.repositories import RunRepository


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Local e2e flow with simulated webhooks.")
    parser.add_argument("--base-url", help="Use a running server instead of in-process app.")
    parser.add_argument("--api-key", default="dev-api-key", help="API key for requests.")
    parser.add_argument("--workflow", default="aismr", help="Workflow/project name.")
    parser.add_argument("--brief", default="Async e2e smoke test", help="Brief to submit.")
    parser.add_argument(
        "--database-url",
        default="sqlite+aiosqlite:///./e2e_local.db",
        help="Scratch DB when running in-process.",
    )
    parser.add_argument(
        "--sleep",
        type=float,
        default=0.2,
        help="Delay between webhook calls to let background tasks flush.",
    )
    return parser.parse_args()


async def start_run(client: AsyncClient, headers: dict, workflow: str, brief: str) -> str:
    resp = await client.post(
        "/v1/runs/start",
        json={"workflow": workflow, "brief": brief},
        headers=headers,
    )
    resp.raise_for_status()
    payload = resp.json()
    return payload["run_id"]


async def send_sora_webhook(client: AsyncClient, run_id: str) -> None:
    payload = {
        "code": 200,
        "msg": "success",
        "data": {
            "taskId": "video_0",
            "state": "success",
            "info": {"resultUrls": ["https://cdn.example.com/sora-clip.mp4"]},
            "metadata": {"videoIndex": 0},
        },
    }
    resp = await client.post(
        f"/v1/webhooks/sora?run_id={run_id}",
        content=json.dumps(payload),
        headers={"Content-Type": "application/json"},
    )
    resp.raise_for_status()


async def send_remotion_webhook(client: AsyncClient, run_id: str) -> None:
    payload = {
        "status": "done",
        "output_url": "https://cdn.example.com/render.mp4",
        "id": "job-0",
    }
    resp = await client.post(
        f"/v1/webhooks/remotion?run_id={run_id}",
        content=json.dumps(payload),
        headers={"X-Remotion-Signature": "", "Content-Type": "application/json"},
    )
    resp.raise_for_status()


async def fetch_run(client: AsyncClient, run_id: str, headers: dict) -> dict:
    resp = await client.get(f"/v1/runs/{run_id}", headers=headers)
    resp.raise_for_status()
    return resp.json()


async def verify_with_repo(run_id: str) -> None:
    """Double-check persisted artifacts/status when running in-process."""
    SessionLocal = get_async_session_factory()
    async with SessionLocal() as session:
        repo = RunRepository(session)
        run = await repo.get_async(UUID(run_id))
        assert run is not None, "run missing"
        assert run.status in ("awaiting_publish_approval", "awaiting_publish"), run.status
        artifacts = run.artifacts or {}
        assert "video" in artifacts, f"expected video artifact, found {artifacts}"


async def main() -> None:
    args = parse_args()

    if args.base_url:
        transport = None
        base_url = args.base_url.rstrip("/")
    else:
        # In-process defaults: fake providers, async sqlite, no background workflows
        settings.use_fake_providers = True
        settings.disable_background_workflows = True
        settings.database_url = args.database_url
        settings.api_key = args.api_key
        await init_async_db()
        transport = ASGITransport(app=app)
        base_url = "http://test"

    headers = {"X-API-Key": args.api_key}

    async with AsyncClient(transport=transport, base_url=base_url) as client:
        run_id = await start_run(client, headers, args.workflow, args.brief)
        await send_sora_webhook(client, run_id)
        await anyio.sleep(args.sleep)
        await send_remotion_webhook(client, run_id)
        await anyio.sleep(args.sleep)

        detail = await fetch_run(client, run_id, headers)
        print(f"Run status: {detail['status']}")
        print(f"Artifacts: {detail.get('artifacts')}")

    if not args.base_url:
        await verify_with_repo(run_id)
        print("DB verification ok (video artifact + awaiting publish approval).")


if __name__ == "__main__":
    anyio.run(main)
