"""Phase 3: White space and gap analysis."""

from __future__ import annotations

from typing import Any


def build_gap_analysis_context(
    opportunity: dict[str, Any],
    research_data: dict[str, Any],
    competitive_landscape: dict[str, Any],
) -> dict[str, Any]:
    """Build context for the gap analyst agent."""
    return {
        "opportunity_title": opportunity.get("title", ""),
        "problem_space": opportunity.get("problem_space", ""),
        "research_data": str(research_data),
        "competitive_landscape": str(competitive_landscape),
    }


def score_ai_moat(gap_analysis: dict[str, Any]) -> float:
    """Extract and validate the AI moat score from gap analysis."""
    score = gap_analysis.get("ai_moat_score", 0)
    try:
        return max(0.0, min(10.0, float(score)))
    except (ValueError, TypeError):
        return 0.0
