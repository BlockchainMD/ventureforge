"""Decides which agents to call and in what order."""

from __future__ import annotations

from ventureforge.core.schemas import PhaseConfig

# Standard agent sequence per round
SCREENER_AGENT_SEQUENCE = ["researcher", "generator", "critic", "synthesizer", "scorer"]
BUILDER_AGENT_SEQUENCE = [
    "researcher",
    "generator",
    "critic",
    "synthesizer",
    "scorer",
    "consistency_checker",
]

# Phase configurations for the screener
SCREENER_PHASES: list[PhaseConfig] = [
    PhaseConfig(
        phase_name="horizon_scan",
        agent_sequence=SCREENER_AGENT_SEQUENCE,
        max_rounds=4,
        quality_threshold=0.82,
        rubric_key="horizon_scan",
    ),
    PhaseConfig(
        phase_name="deep_dive",
        agent_sequence=["researcher", "synthesizer", "scorer"],
        max_rounds=3,
        quality_threshold=0.78,
        rubric_key="deep_dive",
    ),
    PhaseConfig(
        phase_name="gap_analysis",
        agent_sequence=["gap_analyst", "critic", "scorer"],
        max_rounds=3,
        quality_threshold=0.80,
        rubric_key="gap_analysis",
    ),
    PhaseConfig(
        phase_name="final_ranking",
        agent_sequence=["synthesizer", "scorer"],
        max_rounds=2,
        quality_threshold=0.80,
        rubric_key="horizon_scan",
    ),
]

# Builder section order
BUILDER_SECTIONS = [
    "problem_statement",
    "solution_architecture",
    "market_sizing",
    "competitive_landscape",
    "business_model",
    "go_to_market",
    "tech_stack",
    "team_profile",
    "financial_projections",
    "risk_register",
    "pitch_narrative",
]

# Sections after which full consistency check runs
CONSISTENCY_CHECK_POINTS = {"business_model", "team_profile", "pitch_narrative"}


def get_screener_phases(
    max_rounds: int = 4, quality_threshold: float = 0.82
) -> list[PhaseConfig]:
    """Get screener phase configs with optional overrides."""
    return [
        phase.model_copy(
            update={"max_rounds": max_rounds, "quality_threshold": quality_threshold}
        )
        for phase in SCREENER_PHASES
    ]


def get_builder_phase(
    section_name: str,
    max_rounds: int = 3,
    quality_threshold: float = 0.85,
) -> PhaseConfig:
    """Get a builder phase config for a specific section."""
    return PhaseConfig(
        phase_name=section_name,
        agent_sequence=BUILDER_AGENT_SEQUENCE,
        max_rounds=max_rounds,
        quality_threshold=quality_threshold,
        rubric_key=section_name,
    )
