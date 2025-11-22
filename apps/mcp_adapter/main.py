from __future__ import annotations

import asyncio
import logging
from typing import Any, Awaitable, Callable, Dict
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from prometheus_fastapi_instrumentator import Instrumentator

from .config import get_settings

logger = logging.getLogger("myloware.mcp_adapter")
settings = get_settings()

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _client
    try:
        _client = httpx.AsyncClient(timeout=settings.request_timeout_seconds)
        yield
    finally:
        if _client:
            await _client.aclose()
            _client = None


app = FastAPI(title="MyloWare MCP Adapter", version="0.1.0", lifespan=lifespan)

Instrumentator().instrument(app).expose(app, include_in_schema=False)

_client: httpx.AsyncClient | None = None


class JsonRpcRequest(BaseModel):
    jsonrpc: str = Field(default="2.0")
    id: str | int | None = None
    method: str
    params: Dict[str, Any] | None = None


class JsonRpcResponse(BaseModel):
    jsonrpc: str = "2.0"
    id: str | int | None = None
    result: Any | None = None
    error: Dict[str, Any] | None = None


async def get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=settings.request_timeout_seconds)
    return _client


async def _forward_api(
    method: str,
    url: str,
    *,
    json: Dict[str, Any] | None = None,
) -> Any:
    client = await get_client()
    headers = {"x-api-key": settings.api_key}
    if method.upper() == "GET":
        resp = await client.get(url, headers=headers, params=json)
    else:
        resp = await client.request(method.upper(), url, headers=headers, json=json)
    try:
        data = resp.json()
    except Exception:
        data = {}
    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=data)
    return data


async def handle_get_run(params: Dict[str, Any] | None) -> Any:
    if not params or "runId" not in params:
        raise HTTPException(status_code=400, detail="runId is required")
    run_id = params["runId"]
    url = f"{settings.api_base_url}/v1/runs/{run_id}"
    return await _forward_api("GET", url)


async def handle_list_projects(_: Dict[str, Any] | None) -> Any:
    url = f"{settings.api_base_url}/v1/projects"
    return await _forward_api("GET", url)


async def handle_ask_brendan(params: Dict[str, Any] | None) -> Any:
    if not params or "user_id" not in params or "message" not in params:
        raise HTTPException(status_code=400, detail="user_id and message are required")
    url = f"{settings.api_base_url}/v1/chat/brendan"
    payload = {"user_id": params["user_id"], "message": params["message"]}
    return await _forward_api("POST", url, json=payload)


HANDLERS: Dict[str, Callable[[Dict[str, Any] | None], Awaitable[Any]]] = {
    "get_run_status": handle_get_run,
    "list_projects": handle_list_projects,
    "ask_brendan": handle_ask_brendan,
}


@app.post("/mcp", response_model=JsonRpcResponse)
async def mcp_endpoint(payload: JsonRpcRequest) -> JsonRpcResponse:
    handler = HANDLERS.get(payload.method)
    if handler is None:
        return JsonRpcResponse(id=payload.id, error={"code": -32601, "message": "Method not found"})
    try:
        result = await handler(payload.params)
        return JsonRpcResponse(id=payload.id, result=result)
    except HTTPException as exc:
        return JsonRpcResponse(
            id=payload.id,
            error={"code": exc.status_code, "message": exc.detail},
        )
    except Exception as exc:
        logger.exception("Unhandled MCP error")
        return JsonRpcResponse(
            id=payload.id,
            error={"code": -32000, "message": str(exc)},
        )


@app.get("/health")
async def health() -> Dict[str, str]:
    return {"status": "ok", "environment": settings.environment}
