"""All scoring rubric definitions."""

from __future__ import annotations

from pydantic import BaseModel, Field


class ScoringDimension(BaseModel):
    """A single scoring dimension within a rubric."""

    name: str
    weight: float
    description: str
    scoring_guide: dict[int, str] = Field(default_factory=dict)


class Rubric(BaseModel):
    """A complete scoring rubric for a phase or section."""

    phase: str
    dimensions: list[ScoringDimension]
    advancement_threshold: float = 0.82
    max_rounds: int = 4


# --- Screener Rubrics ---

HORIZON_SCAN_RUBRIC = Rubric(
    phase="horizon_scan",
    dimensions=[
        ScoringDimension(
            name="problem_severity",
            weight=0.25,
            description="Is this a genuine, painful, expensive problem?",
            scoring_guide={
                0: "Not a real problem",
                4: "Minor inconvenience",
                6: "Significant pain but workarounds exist",
                8: "Major pain with costly workarounds",
                10: "Critical, expensive, unsolved pain",
            },
        ),
        ScoringDimension(
            name="ai_necessity",
            weight=0.25,
            description="Is agentic AI specifically required, or could simpler tools work?",
            scoring_guide={
                0: "No AI needed",
                4: "AI helps but not essential",
                6: "AI significantly improves outcome",
                8: "Requires multi-step AI reasoning",
                10: "Impossible without agentic AI",
            },
        ),
        ScoringDimension(
            name="market_size_signal",
            weight=0.20,
            description="Evidence of large total addressable market",
            scoring_guide={
                0: "No market evidence",
                4: "Niche market",
                6: "Moderate market with growth",
                8: "Large market with clear data",
                10: "Massive, well-documented TAM",
            },
        ),
        ScoringDimension(
            name="timing_signal",
            weight=0.15,
            description="Why is now the right time?",
            scoring_guide={
                0: "No timing catalyst",
                4: "General trend",
                6: "Specific recent enablers",
                8: "Clear window opening now",
                10: "Perfect storm of catalysts",
            },
        ),
        ScoringDimension(
            name="moat_potential",
            weight=0.15,
            description="Can this be defensible long-term?",
            scoring_guide={
                0: "Trivially replicable",
                4: "Temporary head start",
                6: "Data or network effects possible",
                8: "Strong structural moat",
                10: "Deep, multi-layered defensibility",
            },
        ),
    ],
    advancement_threshold=0.82,
    max_rounds=4,
)

DEEP_DIVE_RUBRIC = Rubric(
    phase="deep_dive",
    dimensions=[
        ScoringDimension(name="research_depth", weight=0.30, description="Quality and depth of research"),
        ScoringDimension(name="competitor_clarity", weight=0.25, description="Clear competitive landscape"),
        ScoringDimension(name="market_data_quality", weight=0.25, description="Specific market data with sources"),
        ScoringDimension(name="customer_evidence", weight=0.20, description="Evidence of customer pain"),
    ],
    advancement_threshold=0.78,
    max_rounds=3,
)

GAP_ANALYSIS_RUBRIC = Rubric(
    phase="gap_analysis",
    dimensions=[
        ScoringDimension(name="gap_specificity", weight=0.20, description="How specific is the identified gap?"),
        ScoringDimension(name="agentic_justification", weight=0.25, description="Why does this need AI agency?"),
        ScoringDimension(name="incumbent_analysis", weight=0.15, description="Quality of incumbent weakness analysis"),
        ScoringDimension(name="timing_evidence", weight=0.20, description="Specific timing catalyst with evidence"),
        ScoringDimension(
            name="assumption_stress_test",
            weight=0.20,
            description="Has the analysis identified and pressure-tested its foundational assumptions?",
            scoring_guide={
                0: "No assumptions identified",
                4: "Assumptions listed but not tested",
                6: "Assumptions identified with what-breaks-them analysis",
                8: "Deep assumption attack with evidence for/against each",
                10: "Found the fragile consensus and has data on whether it holds",
            },
        ),
    ],
    advancement_threshold=0.80,
    max_rounds=3,
)

# --- Builder Rubrics ---

MARKET_SIZING_RUBRIC = Rubric(
    phase="market_sizing",
    dimensions=[
        ScoringDimension(name="methodology_transparency", weight=0.35, description="Is the TAM built bottom-up with sources?"),
        ScoringDimension(name="conservative_realism", weight=0.35, description="Does SOM feel achievable in 18 months?"),
        ScoringDimension(name="specificity", weight=0.30, description="Named customers, named verticals, not vague"),
    ],
    advancement_threshold=0.85,
    max_rounds=3,
)

GO_TO_MARKET_RUBRIC = Rubric(
    phase="go_to_market",
    dimensions=[
        ScoringDimension(name="icp_specificity", weight=0.35, description="Named persona with pain/job/budget context"),
        ScoringDimension(name="channel_defensibility", weight=0.30, description="Is this channel owned or rented?"),
        ScoringDimension(name="sequencing_logic", weight=0.35, description="Does GTM motion match sales cycle?"),
    ],
    advancement_threshold=0.85,
    max_rounds=3,
)

FINANCIAL_PROJECTIONS_RUBRIC = Rubric(
    phase="financial_projections",
    dimensions=[
        ScoringDimension(name="assumption_explicitness", weight=0.35, description="Every line has a named assumption"),
        ScoringDimension(name="unit_economics_coherence", weight=0.35, description="CAC/LTV/payback match GTM"),
        ScoringDimension(name="milestone_clarity", weight=0.30, description="Clear 30/60/90/180-day milestones"),
    ],
    advancement_threshold=0.85,
    max_rounds=3,
)

# Generic builder rubric for sections without a specific one
GENERIC_BUILDER_RUBRIC = Rubric(
    phase="generic_builder",
    dimensions=[
        ScoringDimension(name="specificity", weight=0.25, description="Specific, not generic"),
        ScoringDimension(name="evidence_quality", weight=0.25, description="Claims backed by evidence"),
        ScoringDimension(name="coherence", weight=0.15, description="Internally consistent"),
        ScoringDimension(name="actionability", weight=0.15, description="Actionable, not theoretical"),
        ScoringDimension(
            name="assumption_stress_test",
            weight=0.20,
            description="Has the analysis identified its own load-bearing assumptions and tested them?",
            scoring_guide={
                0: "No awareness of underlying assumptions",
                4: "Assumptions mentioned but taken for granted",
                6: "Key assumptions identified with risk notes",
                8: "Assumptions stress-tested with what-breaks-them analysis",
                10: "Steelmanned arguments with honest assessment of remaining fractures",
            },
        ),
    ],
    advancement_threshold=0.85,
    max_rounds=3,
)

# Registry of all rubrics
RUBRIC_REGISTRY: dict[str, Rubric] = {
    "horizon_scan": HORIZON_SCAN_RUBRIC,
    "deep_dive": DEEP_DIVE_RUBRIC,
    "gap_analysis": GAP_ANALYSIS_RUBRIC,
    "market_sizing": MARKET_SIZING_RUBRIC,
    "go_to_market": GO_TO_MARKET_RUBRIC,
    "financial_projections": FINANCIAL_PROJECTIONS_RUBRIC,
}


def get_rubric(phase: str) -> Rubric:
    """Get rubric for a phase, falling back to generic builder rubric."""
    return RUBRIC_REGISTRY.get(phase, GENERIC_BUILDER_RUBRIC)
