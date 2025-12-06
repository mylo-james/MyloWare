"""FastAPI application for MyloWare API."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from importlib.metadata import version
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Security
from fastapi.security import APIKeyHeader
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from api import routes
from api.routes import chat, telegram, webhooks, media
from client import get_client
from config import settings
from knowledge.setup import setup_project_knowledge
from observability import setup_langfuse

logger = logging.getLogger(__name__)

# Rate limiter using client IP
limiter = Limiter(key_func=get_remote_address)


def _load_knowledge_documents() -> list[dict]:
    """Load all markdown knowledge documents into a single list.

    Sources:
    - data/knowledge/*.md           (shared / general + tool docs)
    - data/projects/*/knowledge/*.md (project-scoped knowledge, ingested into same store)
    """

    documents: list[dict] = []

    # Shared/general knowledge
    knowledge_dir = Path("data/knowledge")
    if knowledge_dir.exists():
        for md_file in knowledge_dir.glob("*.md"):
            logger.info("Loading knowledge document: %s", md_file)
            content = md_file.read_text()
            documents.append(
                {
                    "id": md_file.stem,
                    "content": content,
                    "metadata": {"source": str(md_file), "type": "knowledge", "scope": "shared"},
                }
            )
    else:
        logger.warning("Knowledge directory not found: %s", knowledge_dir)

    # Project-scoped knowledge (ingested into same store per current policy)
    projects_dir = Path("data/projects")
    if projects_dir.exists():
        for project_path in projects_dir.iterdir():
            project_knowledge = project_path / "knowledge"
            if project_knowledge.exists():
                for md_file in project_knowledge.glob("*.md"):
                    logger.info("Loading project knowledge: %s", md_file)
                    content = md_file.read_text()
                    documents.append(
                        {
                            "id": f"{project_path.name}-{md_file.stem}",
                            "content": content,
                            "metadata": {
                                "source": str(md_file),
                                "type": "knowledge",
                                "scope": "project",
                                "project": project_path.name,
                            },
                        }
                    )

    return documents


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan - setup knowledge base on startup."""
    logger.info("Starting MyloWare API...")

    # Setup Langfuse observability
    setup_langfuse()

    # Skip knowledge base setup in development mode (USE_FAKE_PROVIDERS=true)
    # The vector store operations can crash Llama Stack due to SQLite locking issues
    if settings.use_fake_providers:
        logger.info("Skipping knowledge base setup (USE_FAKE_PROVIDERS=true)")
        app.state.vector_db_id = "project_kb_myloware"
    else:
        # Setup knowledge base (skips if already populated)
        try:
            client = get_client()
            project_id = getattr(settings, "project_id", "myloware")
            documents = _load_knowledge_documents()
            
            vector_db_id = setup_project_knowledge(
                client, 
                project_id, 
                documents=documents if documents else None
            )
            
            app.state.vector_db_id = vector_db_id
            logger.info("Knowledge base ready: %s", vector_db_id)

        except Exception as exc:
            logger.error("Failed to setup knowledge base: %s", exc)
            # Continue anyway - RAG will just not work
            app.state.vector_db_id = "project_kb_myloware"

    yield

    logger.info("Shutting down MyloWare API...")


api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


async def verify_api_key(api_key: str = Security(api_key_header)) -> str:
    """Verify API key authentication for all endpoints."""

    if api_key is None:
        raise HTTPException(status_code=401, detail="Missing API key")
    if api_key != settings.api_key:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return api_key


app = FastAPI(
    title="MyloWare API",
    description="Llama Stack-native multi-agent video production platform",
    version=version("myloware"),
    lifespan=lifespan,
)

# Add rate limiting
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


# Include routers
auth_deps = [Depends(verify_api_key)]
app.include_router(routes.health.router)  # Health check is public (for Docker/K8s)
app.include_router(routes.runs.router, prefix="/v1/runs", dependencies=auth_deps)
app.include_router(chat.router, dependencies=auth_deps)
app.include_router(telegram.router)
app.include_router(webhooks.router)
app.include_router(media.router)


__all__ = ["app", "verify_api_key", "api_key_header", "limiter"]
