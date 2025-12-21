"""Memory bank CLI commands."""

from __future__ import annotations

import click

from myloware.cli.ui import console
from myloware.llama_clients import get_sync_client


@click.group()
def memory() -> None:
    """Memory bank commands."""


@memory.command()
def setup() -> None:
    """Register user-preferences memory bank."""
    from myloware.memory.banks import register_memory_bank

    client = get_sync_client()
    register_memory_bank(client, "user-preferences")
    console.print("Memory bank 'user-preferences' registered")


@memory.command()
@click.argument("user_id")
def clear(user_id: str) -> None:
    """Clear memory for a user."""
    from myloware.memory.banks import clear_user_memory

    client = get_sync_client()
    clear_user_memory(client, user_id)
    console.print(f"Memory cleared for user: {user_id}")


def register(cli: click.Group) -> None:
    cli.add_command(memory)
