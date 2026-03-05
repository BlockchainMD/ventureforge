"""Phase 1: Horizon Scan - breadth generation of 20-30 candidates."""

from __future__ import annotations

from typing import Any


def build_horizon_scan_context(
    domain: str | None,
    constraints: list[str],
    anti_patterns: list[str],
    excluded_opportunities: list[str],
    research_bundle: dict[str, Any] | None = None,
    lessons: list[str] | None = None,
    candidate_count: int = 25,
) -> dict[str, Any]:
    """Build the context dict for the horizon scan phase."""
    return {
        "domain": domain or "open exploration across all B2B verticals",
        "constraints": ", ".join(constraints) if constraints else "none",
        "anti_patterns": ", ".join(anti_patterns) if anti_patterns else "none",
        "excluded_opportunities": "\n".join(excluded_opportunities) if excluded_opportunities else "none",
        "research_bundle": str(research_bundle or {}),
        "lessons": "\n".join(f"- {l}" for l in (lessons or [])),
        "candidate_count": str(candidate_count),
    }


def filter_shortlist(
    candidates: list[dict[str, Any]],
    max_candidates: int = 8,
    min_score: float = 6.5,
) -> list[dict[str, Any]]:
    """Filter candidates to shortlist by composite score."""
    scored = [c for c in candidates if c.get("composite_score", 0) >= min_score]
    scored.sort(key=lambda c: c.get("composite_score", 0), reverse=True)
    return scored[:max_candidates]
