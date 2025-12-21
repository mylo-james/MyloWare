#!/usr/bin/env python3
"""Set up user preferences memory bank."""

from client import get_client
from myloware.memory.banks import register_memory_bank


def main() -> None:
    client = get_client()
    register_memory_bank(client, "user-preferences")
    print("Memory bank 'user-preferences' registered")


if __name__ == "__main__":
    main()
