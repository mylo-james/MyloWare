"""MyloWare command-line interface.

The CLI is organized into submodules under `myloware.cli.*` to keep the surface
area maintainable as the project grows.
"""

from __future__ import annotations

import click

from myloware.app_version import get_app_version
from myloware.observability import init_observability


@click.group()
@click.version_option(version=get_app_version(), prog_name="myloware")
def cli() -> None:
    """MyloWare - Llama Stack multi-agent video production."""
    init_observability()


def _register_commands() -> None:
    from myloware.cli import (
        config,
        demo,
        dev,
        eval,
        kb,
        memory,
        runs,
        stack,
        traces,
        webhooks,
        worker,
    )

    config.register(cli)
    demo.register(cli)
    dev.register(cli)
    eval.register(cli)
    kb.register(cli)
    memory.register(cli)
    runs.register(cli)
    stack.register(cli)
    traces.register(cli)
    webhooks.register(cli)
    worker.register(cli)


_register_commands()


if __name__ == "__main__":
    cli()
