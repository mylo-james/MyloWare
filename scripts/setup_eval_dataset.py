#!/usr/bin/env python3
"""Set up evaluation dataset in Llama Stack."""

import json
from pathlib import Path

from client import get_client
from myloware.observability.datasets import append_rows, register_dataset


def main() -> None:
    client = get_client()
    seed_file = Path("data/eval/ideator_test_cases.json")
    rows = json.loads(seed_file.read_text()) if seed_file.exists() else []

    register_dataset(client, dataset_id="ideator-eval", rows=rows)

    if rows:
        append_rows(client, dataset_id="ideator-eval", rows=rows)
        print(f"Dataset 'ideator-eval' created with {len(rows)} rows")
    else:
        print("No seed rows found; dataset registered empty.")


if __name__ == "__main__":
    main()
