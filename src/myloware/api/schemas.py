"""Shared Pydantic response models for OpenAPI."""

from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List


class ErrorResponse(BaseModel):
    error: str = Field(..., description="Machine-readable error code")
    detail: Optional[str | Dict[str, Any]] = Field(
        None, description="Human-readable or structured error detail"
    )


class HealthResponse(BaseModel):
    status: str
    version: str
    degraded_mode: bool = False
    provider_modes: Dict[str, str] = Field(default_factory=dict)
    knowledge_base_healthy: Optional[bool] = None
    shields_available: Optional[bool] = None
    vector_db_id: Optional[str] = None
    render_sandbox_enabled: Optional[bool] = None
    llama_stack_reachable: Optional[bool] = None
    llama_stack_models: Optional[list[str]] = None
    llama_stack_error: Optional[str] = None
    llama_stack_circuit: Optional[str] = Field(
        None, description="Circuit breaker state: closed, open, or half_open"
    )


class RunDetailResponse(BaseModel):
    run_id: str
    workflow_name: str
    status: str
    current_step: Optional[str] = None
    artifacts: Dict[str, Any] | None = None
    error: Optional[str] = None


class ResumeRunResponse(RunDetailResponse):
    action: Optional[str] = None
    message: Optional[str] = None


class ApproveResponse(BaseModel):
    run_id: str
    status: str
    current_step: Optional[str] = None
    artifacts: Dict[str, Any] | None = None
    error: Optional[str] = None


class RunListItem(BaseModel):
    run_id: str
    workflow_name: str
    status: str
    current_step: Optional[str] = None
    user_id: Optional[str] = None


class RunListResponse(BaseModel):
    runs: List[RunListItem]
    count: int


class ChatResponseModel(BaseModel):
    response: str
    run_id: Optional[str] = None
    actions_taken: List[str] = []


class TelegramWebhookResponse(BaseModel):
    ok: bool
    status: Optional[str] = None
    reason: Optional[str] = None


class WebhookAck(BaseModel):
    status: str
    run_id: Optional[str] = None
    task_id: Optional[str] = None
    video_index: Optional[int] = None
    video_url: Optional[str] = None
    error: Optional[str] = None


class RemotionWebhookResponse(BaseModel):
    status: str
    run_id: Optional[str] = None
    error: Optional[str] = None
    output_url: Optional[str] = None


class CallbackResponse(BaseModel):
    ok: bool
    status: Optional[str] = None
    error: Optional[str] = None
