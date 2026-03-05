"""Final scoring, ranking, and opportunity thesis generation."""

from __future__ import annotations

from typing import Any


def rank_opportunities(
    candidates: list[dict[str, Any]],
    weights: dict[str, float] | None = None,
) -> list[dict[str, Any]]:
    """Rank candidates by weighted composite score."""
    default_weights = {
        "problem_severity": 0.25,
        "ai_necessity": 0.25,
        "market_size_signal": 0.20,
        "timing_signal": 0.15,
        "moat_potential": 0.15,
    }
    w = weights or default_weights

    for candidate in candidates:
        scores = candidate.get("scores", {})
        composite = sum(
            scores.get(dim, 0) * weight
            for dim, weight in w.items()
        )
        candidate["composite_score"] = composite / 10.0  # Normalize to 0-1

    ranked = sorted(candidates, key=lambda c: c.get("composite_score", 0), reverse=True)

    for i, c in enumerate(ranked):
        c["rank"] = i + 1

    return ranked


def build_thesis_context(
    top_candidate: dict[str, Any],
    research_data: dict[str, Any],
    gap_analysis: dict[str, Any],
    critique: dict[str, Any],
) -> dict[str, Any]:
    """Build context for the opportunity thesis synthesizer."""
    return {
        "title": top_candidate.get("title", ""),
        "problem_space": top_candidate.get("problem_space", ""),
        "scores": str(top_candidate.get("scores", {})),
        "research_data": str(research_data),
        "gap_analysis": str(gap_analysis),
        "critique": str(critique),
    }
