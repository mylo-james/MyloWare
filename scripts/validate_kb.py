#!/usr/bin/env python3
"""Knowledge Base Validation Script.

Runs test queries against the knowledge base and reports retrieval metrics.

Usage:
    python scripts/validate_kb.py
    python scripts/validate_kb.py --verbose
    python scripts/validate_kb.py --output results.json

Requirements:
    - Llama Stack server running (docker compose up)
    - Knowledge base ingested
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

# Add src to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from llama_stack_client import LlamaStackClient
from myloware.config import settings

# Test queries with expected documents
TEST_QUERIES = [
    # Storytelling & Hooks
    {
        "query": "How do I write a good hook for TikTok?",
        "expected": ["viral-hooks", "hooks-and-retention"],
        "agent": "Ideator",
    },
    {
        "query": "What makes videos go viral?",
        "expected": ["viral-hooks", "hooks-and-retention", "engagement-psychology"],
        "agent": "Ideator",
    },
    {
        "query": "Why do people share content?",
        "expected": ["engagement-psychology"],
        "agent": "Ideator",
    },
    # Platform Knowledge
    {
        "query": "What are TikTok video dimensions?",
        "expected": ["tiktok-specs"],
        "agent": "Producer",
    },
    {
        "query": "How does the TikTok algorithm work?",
        "expected": ["tiktok-algorithm"],
        "agent": "Publisher",
    },
    {
        "query": "How do I find good hashtags?",
        "expected": ["hashtag-guide"],
        "agent": "Publisher",
    },
    {
        "query": "What's not allowed on TikTok?",
        "expected": ["community-guidelines"],
        "agent": "All",
    },
    # Video Production
    {
        "query": "How do I structure a video script?",
        "expected": ["video-scripting-guide"],
        "agent": "Producer",
    },
    {
        "query": "What shot types should I use?",
        "expected": ["shot-types-reference"],
        "agent": "Producer",
    },
    {
        "query": "How do I prompt Veo3 for a close-up shot?",
        "expected": ["veo3-prompting-guide"],
        "agent": "Producer",
    },
    {
        "query": "My Veo3 video has artifacts",
        "expected": ["veo3-pitfalls"],
        "agent": "Producer",
    },
    # Composition
    {
        "query": "My objects are cut off in vertical video",
        "expected": ["vertical-video-framing"],
        "agent": "Producer",
    },
    {
        "query": "I need more creative object ideas",
        "expected": ["unique-object-generation"],
        "agent": "Ideator",
    },
    # Editing
    {
        "query": "How do I add text overlays?",
        "expected": ["text-overlay-guide"],
        "agent": "Editor",
    },
    {
        "query": "What transitions work for short videos?",
        "expected": ["transitions-guide"],
        "agent": "Editor",
    },
    # Publishing
    {
        "query": "How should I write captions?",
        "expected": ["caption-writing"],
        "agent": "Publisher",
    },
    # ASMR Niche
    {
        "query": "What ASMR triggers work best?",
        "expected": ["asmr-niche-guide"],
        "agent": "Ideator",
    },
    {
        "query": "How do I pace an ASMR video?",
        "expected": ["asmr-niche-guide"],
        "agent": "Producer",
    },
]


@dataclass
class QueryResult:
    """Result of a single test query."""

    query: str
    expected: list[str]
    retrieved: list[str]
    scores: list[float]
    hit: bool
    best_match: str | None
    best_score: float
    agent: str


@dataclass
class ValidationReport:
    """Full validation report."""

    timestamp: str
    total_queries: int
    hits: int
    misses: int
    hit_rate: float
    mean_score: float
    results: list[dict] = field(default_factory=list)
    gaps: list[dict] = field(default_factory=list)
    config: dict = field(default_factory=dict)


def search_kb(
    client: LlamaStackClient, query: str, vector_store_id: str
) -> tuple[list[str], list[float]]:
    """Search the knowledge base and return document names and scores."""
    try:
        response = client.vector_stores.search(
            vector_store_id=vector_store_id,
            query=query,
            search_mode="hybrid",
            max_num_results=10,
        )

        docs = []
        scores = []

        if response and hasattr(response, "data"):
            for result in response.data:
                filename = getattr(result, "filename", "unknown")
                score = getattr(result, "score", 0.0)
                docs.append(filename)
                scores.append(score)

        return docs, scores

    except Exception as e:
        print(f"  ⚠️  Search error: {e}")
        return [], []


def check_hit(expected: list[str], retrieved: list[str]) -> tuple[bool, str | None]:
    """Check if any expected document was retrieved."""
    for doc in retrieved:
        for exp in expected:
            if exp.lower() in doc.lower():
                return True, doc
    return False, None


def run_validation(
    client: LlamaStackClient,
    vector_store_id: str,
    verbose: bool = False,
) -> ValidationReport:
    """Run all test queries and generate validation report."""

    results = []
    hits = 0
    all_scores = []
    gaps = []

    print("\n🔍 Running KB Validation...")
    print(f"   Vector Store: {vector_store_id}")
    print(f"   Test Queries: {len(TEST_QUERIES)}")
    print("-" * 60)

    for i, test in enumerate(TEST_QUERIES, 1):
        query = test["query"]
        expected = test["expected"]
        agent = test["agent"]

        # Search
        retrieved, scores = search_kb(client, query, vector_store_id)

        # Check hit
        hit, best_match = check_hit(expected, retrieved)
        best_score = scores[0] if scores else 0.0

        if hit:
            hits += 1
            status = "✅"
        else:
            status = "❌"
            gaps.append(
                {
                    "query": query,
                    "expected": expected,
                    "retrieved": retrieved[:3],
                    "agent": agent,
                }
            )

        if scores:
            all_scores.extend(scores[:3])  # Top 3 scores

        result = QueryResult(
            query=query,
            expected=expected,
            retrieved=retrieved[:5],
            scores=scores[:5],
            hit=hit,
            best_match=best_match,
            best_score=best_score,
            agent=agent,
        )
        results.append(result)

        if verbose:
            print(f'\n{i}. {status} [{agent}] "{query[:50]}..."')
            print(f"   Expected: {expected}")
            print(f"   Retrieved: {retrieved[:3]}")
            print(f"   Scores: {[f'{s:.3f}' for s in scores[:3]]}")
            if hit:
                print(f"   Match: {best_match}")
        else:
            print(f"  {status} {query[:60]}")

    # Calculate metrics
    hit_rate = hits / len(TEST_QUERIES) if TEST_QUERIES else 0
    mean_score = sum(all_scores) / len(all_scores) if all_scores else 0

    # Build report
    report = ValidationReport(
        timestamp=datetime.now().isoformat(),
        total_queries=len(TEST_QUERIES),
        hits=hits,
        misses=len(TEST_QUERIES) - hits,
        hit_rate=hit_rate,
        mean_score=mean_score,
        results=[
            {
                "query": r.query,
                "expected": r.expected,
                "retrieved": r.retrieved,
                "scores": r.scores,
                "hit": r.hit,
                "best_match": r.best_match,
                "best_score": r.best_score,
                "agent": r.agent,
            }
            for r in results
        ],
        gaps=gaps,
        config={
            "search_mode": "hybrid",
            "chunk_size": 512,
            "chunk_overlap": 100,
            "max_results": 10,
        },
    )

    return report


def print_report(report: ValidationReport) -> None:
    """Print validation report summary."""
    print("\n" + "=" * 60)
    print("📊 VALIDATION REPORT")
    print("=" * 60)

    # Determine pass/fail
    passed = report.hit_rate >= 0.90
    status = "✅ PASSED" if passed else "❌ FAILED"

    print(f"\n{status} - Hit Rate: {report.hit_rate:.1%} (target: ≥90%)")
    print("\nMetrics:")
    print(f"  • Total Queries: {report.total_queries}")
    print(f"  • Hits: {report.hits}")
    print(f"  • Misses: {report.misses}")
    print(f"  • Hit Rate: {report.hit_rate:.1%}")
    print(f"  • Mean Score: {report.mean_score:.3f}")

    if report.gaps:
        print(f"\n⚠️  Gaps Found ({len(report.gaps)}):")
        for gap in report.gaps:
            print(f"\n  Query: \"{gap['query']}\"")
            print(f"  Expected: {gap['expected']}")
            print(f"  Got: {gap['retrieved']}")
    else:
        print("\n✅ No gaps found - all queries hit expected documents!")

    print("\n" + "=" * 60)


def find_vector_store(client: LlamaStackClient) -> str | None:
    """Find an existing vector store to validate."""
    try:
        stores = client.vector_stores.list()
        for store in stores:
            store_name = getattr(store, "name", "")
            store_id = getattr(store, "id", "")
            if "kb" in store_name.lower() or "knowledge" in store_name.lower():
                return store_id
            # Return first available if no KB-specific store
            if store_id:
                return store_id
        return None
    except Exception as e:
        print(f"Error listing vector stores: {e}")
        return None


def main():
    parser = argparse.ArgumentParser(description="Validate KB retrieval quality")
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose output")
    parser.add_argument("--output", "-o", type=str, help="Save results to JSON file")
    parser.add_argument("--vector-store-id", type=str, help="Vector store ID to test")
    args = parser.parse_args()

    # Connect to Llama Stack
    print(f"🔌 Connecting to Llama Stack at {settings.llama_stack_url}...")
    client = LlamaStackClient(base_url=settings.llama_stack_url)

    # Find vector store
    vector_store_id = args.vector_store_id
    if not vector_store_id:
        print("🔍 Looking for vector store...")
        vector_store_id = find_vector_store(client)

    if not vector_store_id:
        print("❌ No vector store found. Please ingest KB first or specify --vector-store-id")
        sys.exit(1)

    print(f"📚 Using vector store: {vector_store_id}")

    # Run validation
    report = run_validation(client, vector_store_id, verbose=args.verbose)

    # Print report
    print_report(report)

    # Save to file if requested
    if args.output:
        output_path = Path(args.output)
        with open(output_path, "w") as f:
            json.dump(
                {
                    "timestamp": report.timestamp,
                    "hit_rate": report.hit_rate,
                    "mean_score": report.mean_score,
                    "total_queries": report.total_queries,
                    "hits": report.hits,
                    "misses": report.misses,
                    "gaps": report.gaps,
                    "results": report.results,
                    "config": report.config,
                },
                f,
                indent=2,
            )
        print(f"\n📁 Results saved to {output_path}")

    # Exit with appropriate code
    if report.hit_rate >= 0.90:
        print("\n✅ KB Validation PASSED!")
        sys.exit(0)
    else:
        print(f"\n❌ KB Validation FAILED (hit rate {report.hit_rate:.1%} < 90%)")
        sys.exit(1)


if __name__ == "__main__":
    main()
