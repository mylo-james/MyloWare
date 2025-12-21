"""Llama Stack management CLI commands."""

from __future__ import annotations

import click
from rich.table import Table

from myloware.cli.ui import console
from myloware.config import settings
from myloware.llama_clients import get_sync_client, list_models, verify_connection


@click.group()
def stack() -> None:
    """Llama Stack management and inspection."""


@stack.command("models")
@click.option("--json", "output_json", is_flag=True, help="Output as JSON")
def stack_models(output_json: bool) -> None:
    """List available models from Llama Stack."""
    try:
        client = get_sync_client()
        models = list_models(client)
        if output_json:
            console.print_json(data={"models": models, "count": len(models)})
            return

        table = Table(title="Available Models", show_lines=False)
        table.add_column("Model ID", style="cyan")
        for model_id in models:
            table.add_row(model_id)
        console.print(table)
        console.print(f"\n[dim]Total: {len(models)} models[/dim]")
    except Exception as exc:
        raise click.ClickException(f"Failed to list models: {exc}") from exc


@stack.command("status")
@click.option("--json", "output_json", is_flag=True, help="Output as JSON")
def stack_status(output_json: bool) -> None:
    """Check Llama Stack server status and verify connection."""
    try:
        client = get_sync_client()
        result = verify_connection(client)
        if output_json:
            console.print_json(data=result)
            return

        if result["success"]:
            console.print("[green]✓ Connection verified[/green]")
            console.print(f"  Models available: {result['models_available']}")
            console.print(f"  Model tested: {result['model_tested']}")
            console.print(f"  Inference works: {'Yes' if result['inference_works'] else 'No'}")
            return

        console.print("[red]✗ Connection failed[/red]")
        console.print(f"  Error: {result.get('error', 'Unknown error')}")
        if result.get("models_available", 0) > 0:
            console.print(f"  Models available: {result['models_available']}")
    except Exception as exc:
        raise click.ClickException(f"Failed to verify connection: {exc}") from exc


@stack.command("inspect")
@click.option("--json", "output_json", is_flag=True, help="Output as JSON")
def stack_inspect(output_json: bool) -> None:
    """Inspect Llama Stack server configuration."""
    try:
        client = get_sync_client()
        version_info = client.inspect.version()
        if output_json:
            console.print_json(data={"version": str(version_info)})
        else:
            console.print(f"[bold]Llama Stack Version:[/bold] {version_info}")
    except Exception as exc:
        raise click.ClickException(f"Failed to inspect server: {exc}") from exc


@stack.command("toolgroups")
@click.option("--json", "output_json", is_flag=True, help="Output as JSON")
def stack_toolgroups(output_json: bool) -> None:
    """List registered toolgroups."""
    try:
        client = get_sync_client()
        toolgroups = list(client.toolgroups.list())
        if output_json:
            data = [{"id": tg.id, "name": getattr(tg, "name", "")} for tg in toolgroups]
            console.print_json(data={"toolgroups": data, "count": len(data)})
            return

        table = Table(title="Registered Toolgroups", show_lines=False)
        table.add_column("ID", style="cyan")
        table.add_column("Name", style="white")
        for tg in toolgroups:
            table.add_row(tg.id, getattr(tg, "name", ""))
        console.print(table)
        console.print(f"\n[dim]Total: {len(toolgroups)} toolgroups[/dim]")
    except Exception as exc:
        raise click.ClickException(f"Failed to list toolgroups: {exc}") from exc


@stack.command("providers")
@click.option("--json", "output_json", is_flag=True, help="Output as JSON")
def stack_providers(output_json: bool) -> None:
    """List configured providers."""
    try:
        client = get_sync_client()
        providers = list(client.providers.list())
        if output_json:
            data = [{"id": p.id, "name": getattr(p, "name", "")} for p in providers]
            console.print_json(data={"providers": data, "count": len(data)})
            return

        table = Table(title="Configured Providers", show_lines=False)
        table.add_column("ID", style="cyan")
        table.add_column("Name", style="white")
        for p in providers:
            table.add_row(p.id, getattr(p, "name", ""))
        console.print(table)
        console.print(f"\n[dim]Total: {len(providers)} providers[/dim]")
    except Exception as exc:
        raise click.ClickException(f"Failed to list providers: {exc}") from exc


@stack.command("shields")
@click.option("--json", "output_json", is_flag=True, help="Output as JSON")
@click.argument("shield_id", required=False)
def stack_shields(shield_id: str | None, output_json: bool) -> None:
    """List or inspect safety shields."""
    try:
        client = get_sync_client()
        if shield_id:
            shield = client.shields.retrieve(shield_id)
            if output_json:
                console.print_json(
                    data={"shield": {"id": shield.id, "name": getattr(shield, "name", "")}}
                )
            else:
                console.print(f"[bold]Shield:[/bold] {shield.id}")
                console.print(f"  Name: {getattr(shield, 'name', 'N/A')}")
            return

        shields = list(client.shields.list())
        if output_json:
            data = [{"id": s.id, "name": getattr(s, "name", "")} for s in shields]
            console.print_json(data={"shields": data, "count": len(data)})
            return

        table = Table(title="Safety Shields", show_lines=False)
        table.add_column("ID", style="cyan")
        table.add_column("Name", style="white")
        for s in shields:
            table.add_row(s.id, getattr(s, "name", ""))
        console.print(table)
        console.print(f"\n[dim]Total: {len(shields)} shields[/dim]")
    except Exception as exc:
        raise click.ClickException(f"Failed to list/inspect shields: {exc}") from exc


@stack.group("vector-dbs")
def stack_vector_dbs() -> None:
    """Manage vector databases (vector stores)."""


@stack_vector_dbs.command("list")
@click.option("--json", "output_json", is_flag=True, help="Output as JSON")
def stack_vector_dbs_list(output_json: bool) -> None:
    """List vector databases."""
    try:
        client = get_sync_client()
        vector_dbs = list(client.vector_stores.list())
        if output_json:
            data = [{"id": vs.id, "name": getattr(vs, "name", "")} for vs in vector_dbs]
            console.print_json(data={"vector_dbs": data, "count": len(data)})
            return

        table = Table(title="Vector Databases", show_lines=False)
        table.add_column("ID", style="cyan")
        table.add_column("Name", style="white")
        for vs in vector_dbs:
            table.add_row(vs.id, getattr(vs, "name", ""))
        console.print(table)
        console.print(f"\n[dim]Total: {len(vector_dbs)} vector databases[/dim]")
    except Exception as exc:
        raise click.ClickException(f"Failed to list vector databases: {exc}") from exc


@stack_vector_dbs.command("register")
@click.argument("name")
@click.option("--provider-id", help="Provider ID (milvus|pgvector, default: auto-detect)")
@click.option(
    "--embedding-model",
    default="openai/text-embedding-3-small",
    show_default=True,
    help="Embedding model for the vector DB",
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
@click.option("--json", "output_json", is_flag=True, help="Output as JSON")
def stack_vector_dbs_register(
    name: str,
    provider_id: str | None,
    embedding_model: str,
    embedding_dimension: int | None,
    chunk_size: int,
    chunk_overlap: int,
    output_json: bool,
) -> None:
    """Register a new vector DB."""
    try:
        client = get_sync_client()
        if provider_id is None:
            provider_id = "milvus" if settings.milvus_uri else "pgvector"

        extra_body: dict[str, object] = {
            "provider_id": provider_id,
            "embedding_model": embedding_model,
        }
        if embedding_dimension:
            extra_body["embedding_dimension"] = embedding_dimension

        store = client.vector_stores.create(
            name=name,
            chunking_strategy={
                "type": "static",
                "static": {
                    "max_chunk_size_tokens": chunk_size,
                    "chunk_overlap_tokens": chunk_overlap,
                },
            },
            extra_body=extra_body,
        )

        if output_json:
            console.print_json(
                data={
                    "id": store.id,
                    "name": getattr(store, "name", ""),
                    "provider_id": provider_id,
                    "embedding_model": embedding_model,
                }
            )
        else:
            console.print("[green]Vector DB created[/green]")
            console.print(f"  ID: {store.id}")
            console.print(f"  Name: {getattr(store, 'name', '')}")
            console.print(f"  Provider: {provider_id}")
            console.print(f"  Embedding model: {embedding_model}")
    except Exception as exc:
        raise click.ClickException(f"Failed to register vector database: {exc}") from exc


@stack.command("datasets")
@click.option("--json", "output_json", is_flag=True, help="Output as JSON")
def stack_datasets(output_json: bool) -> None:
    """List evaluation datasets."""
    try:
        client = get_sync_client()
        datasets = list(client.datasets.list())
        if output_json:
            data = [{"id": ds.id, "name": getattr(ds, "name", "")} for ds in datasets]
            console.print_json(data={"datasets": data, "count": len(data)})
            return

        table = Table(title="Evaluation Datasets", show_lines=False)
        table.add_column("ID", style="cyan")
        table.add_column("Name", style="white")
        for ds in datasets:
            table.add_row(ds.id, getattr(ds, "name", ""))
        console.print(table)
        console.print(f"\n[dim]Total: {len(datasets)} datasets[/dim]")
    except Exception as exc:
        raise click.ClickException(f"Failed to list datasets: {exc}") from exc


@stack.command("chat")
@click.argument("prompt")
@click.option("--model", help="Model to use (default: from settings)")
@click.option("--json", "output_json", is_flag=True, help="Output as JSON")
def stack_chat(prompt: str, model: str | None, output_json: bool) -> None:
    """Quick smoke test: send a chat completion to Llama Stack."""
    try:
        client = get_sync_client()
        model_id = model or settings.llama_stack_model
        response = client.chat.completions.create(
            model=model_id,
            messages=[{"role": "user", "content": prompt}],
            stream=False,
        )
        content = None
        if response.choices:
            message = response.choices[0].message
            content = getattr(message, "content", None)
        if output_json:
            console.print_json(data={"model": model_id, "response": content})
        else:
            console.print(f"[bold]Model:[/bold] {model_id}")
            console.print(f"[bold]Response:[/bold]\n{content or '(empty)'}")
    except Exception as exc:
        raise click.ClickException(f"Chat completion failed: {exc}") from exc


def register(cli: click.Group) -> None:
    cli.add_command(stack)
