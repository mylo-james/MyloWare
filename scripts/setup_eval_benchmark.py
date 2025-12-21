#!/usr/bin/env python3
"""Set up evaluation benchmark in Llama Stack."""

from client import get_client
from myloware.observability.evaluation import register_benchmark


def main() -> None:
    client = get_client()
    register_benchmark(
        client,
        benchmark_id="ideator-quality",
        dataset_id="ideator-eval",
        scoring_functions=["llm-as-judge::quality"],
    )
    print("Benchmark 'ideator-quality' registered")


if __name__ == "__main__":
    main()
