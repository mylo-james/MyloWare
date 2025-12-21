"""Knowledge base CLI commands."""

from __future__ import annotations

import subprocess  # nosec B404
import sys

import click

from myloware.cli.ui import console
from myloware.config import settings
from myloware.llama_clients import get_sync_client


@click.group()
def kb() -> None:
    """Knowledge base commands."""


@kb.command("setup")
@click.option("--project", default="global", show_default=True, help="Project ID for KB")
@click.option("--force", is_flag=True, help="Force re-ingestion even if store exists")
@click.option("--verbose", "-v", is_flag=True, help="Verbose output with detailed logging")
@click.option("--provider-id", help="Vector DB provider (milvus|pgvector, default: auto-detect)")
@click.option(
    "--embedding-model",
    default="openai/text-embedding-3-small",
    show_default=True,
    help="Embedding model",
)
@click.option(
    "--embedding-dimension",
    default=None,
    type=int,
    help="Embedding dimension (optional; provider default if omitted)",
)
@click.option(
    "--chunk-size", default=512, show_default=True, type=int, help="Max chunk size in tokens"
)
@click.option(
    "--chunk-overlap", default=100, show_default=True, type=int, help="Chunk overlap in tokens"
)
def kb_setup(
    project: str,
    force: bool,
    verbose: bool,
    provider_id: str | None,
    embedding_model: str,
    embedding_dimension: int | None,
    chunk_size: int,
    chunk_overlap: int,
) -> None:
    """Set up knowledge base by ingesting all KB documents."""
    from myloware.knowledge.loader import load_documents_with_manifest
    from myloware.knowledge.setup import setup_project_knowledge

    if verbose:
        console.print("[dim]Verbose mode enabled[/dim]")

    client = get_sync_client()

    if verbose:
        base_url = getattr(client, "_base_url", None) or settings.llama_stack_url
        console.print(f"[dim]Connected to: {base_url}[/dim]")

    docs_project_id = None if project == "global" else project
    console.print("[bold]Loading knowledge documents...[/bold]")
    docs, manifest = load_documents_with_manifest(
        docs_project_id, include_global=True, read_content=True
    )

    doc_dicts = [
        {
            "id": d.id,
            "content": d.content,
            "metadata": {
                **(d.metadata or {}),
                "filename": d.filename,
                "type": "knowledge",
            },
        }
        for d in docs
    ]

    console.print(f"  Docs loaded: {len(doc_dicts)}")
    console.print(f"  Manifest hash: {manifest.get('hash')}")

    console.print(f"\n[bold]Setting up vector store for project: {project}[/bold]")
    vector_store_id = setup_project_knowledge(
        client=client,
        project_id=project,
        documents=doc_dicts if doc_dicts else None,
        force_reingest=force,
        provider_id=provider_id,
        embedding_model=embedding_model,
        embedding_dimension=embedding_dimension,
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
    )

    console.print("[green]KB setup complete[/green]")
    console.print(f"  Vector store: {vector_store_id}")


@kb.command("validate")
@click.option("--vector-store-id", default=None, help="Vector store ID to validate")
def kb_validate(vector_store_id: str | None) -> None:
    """Validate KB retrieval quality with test queries."""
    cmd = [sys.executable, "scripts/validate_kb.py"]
    if vector_store_id:
        cmd.extend(["--vector-store-id", vector_store_id])

    result = subprocess.run(cmd, cwd=".", check=False)  # nosec B603
    raise SystemExit(result.returncode)


def register(cli: click.Group) -> None:
    cli.add_command(kb)
