"""Phase 2: Deep Dive - research each shortlisted candidate."""

from __future__ import annotations

from typing import Any


def build_research_queries(title: str, problem_space: str) -> list[str]:
    """Build standard research queries for an opportunity."""
    return [
        f"{problem_space} software market size 2024 2025",
        f"{problem_space} startup funding recent",
        f"best {problem_space} tools complaints reviews",
        f"{problem_space} AI automation workflow",
        f"agentic AI {problem_space} use case",
    ]


def build_competitive_landscape(
    title: str,
    research_data: dict[str, Any],
) -> dict[str, Any]:
    """Structure research into a competitive landscape object."""
    insights = research_data.get("insights", [])

    competitors = [i for i in insights if i.get("category") == "competitor"]
    market_data = [i for i in insights if i.get("category") == "market_size"]
    customer_pain = [i for i in insights if i.get("category") == "customer_pain"]
    timing = [i for i in insights if i.get("category") == "timing"]

    return {
        "title": title,
        "competitors": [
            {"claim": c.get("claim", ""), "source": c.get("source_url", "")}
            for c in competitors
        ],
        "market_size_signals": [
            {"claim": m.get("claim", ""), "source": m.get("source_url", "")}
            for m in market_data
        ],
        "customer_complaints": [
            {"claim": p.get("claim", ""), "source": p.get("source_url", "")}
            for p in customer_pain
        ],
        "timing_signals": [
            {"claim": t.get("claim", ""), "source": t.get("source_url", "")}
            for t in timing
        ],
    }
