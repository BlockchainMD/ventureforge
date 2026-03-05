"""Pydantic v2 request/response schemas for VentureForge."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

# --- Input Configs ---


class ScreenerInput(BaseModel):
    """Input configuration for a screener run."""

    domain: str | None = None
    constraints: list[str] = Field(default_factory=list)
    anti_patterns: list[str] = Field(default_factory=list)
    target_funding_stage: str = "pre-seed to Series A"
    geography: str = "US-first"
    exclude_opportunity_ids: list[str] = Field(default_factory=list)
    max_candidates: int = 8
    max_rounds_per_phase: int = 4
    quality_threshold: float = 0.82


class BuilderInput(BaseModel):
    """Input configuration for a builder run."""

    opportunity: OpportunityThesis
    founder_context: str | None = None
    capital_constraints: str | None = None
    target_audience: str = "seed VC"
    depth: Literal["mvp", "full", "investor_ready"] = "investor_ready"
    max_rounds_per_section: int = 3
    quality_threshold: float = 0.85


# --- Opportunity ---


class OpportunityThesis(BaseModel):
    """A fully formed opportunity thesis from the screener."""

    title: str
    one_liner: str
    problem_statement: str
    solution_concept: str
    why_now: str
    why_agentic: str
    market_signal: str
    moat_hypothesis: str
    biggest_risk: str
    comparable_companies: list[str] = Field(default_factory=list)
    recommended_first_customer: str = ""


# Fix forward reference
BuilderInput.model_rebuild()


class OpportunityBrief(BaseModel):
    """Abbreviated opportunity for listing."""

    id: str
    title: str
    composite_score: float
    status: str
    problem_space: str


# --- Agent Outputs ---


class AgentOutput(BaseModel):
    """Output from any agent execution."""

    agent_name: str
    content: dict[str, Any] = Field(default_factory=dict)
    raw_text: str = ""
    token_usage: TokenUsage = Field(default_factory=lambda: TokenUsage())
    duration_seconds: float = 0.0


class TokenUsage(BaseModel):
    """Token consumption for a single LLM call."""

    input_tokens: int = 0
    output_tokens: int = 0
    model: str = ""


# Fix forward reference
AgentOutput.model_rebuild()


# --- Research ---


class ResearchInsight(BaseModel):
    """A structured insight from web research."""

    claim: str
    confidence: Literal["high", "medium", "low"]
    source_url: str
    source_date: datetime | None = None
    category: str  # market_size, competitor, customer_pain, timing
    contradicts: list[str] = Field(default_factory=list)


class ResearchBundle(BaseModel):
    """Collection of research insights for a topic."""

    query: str
    insights: list[ResearchInsight] = Field(default_factory=list)
    raw_results: list[dict[str, Any]] = Field(default_factory=list)


# --- Scoring ---


class DimensionScore(BaseModel):
    """Score for a single rubric dimension."""

    dimension: str
    score: float
    weight: float
    evidence: str
    justification: str


class RoundScores(BaseModel):
    """All scores for a round."""

    dimension_scores: list[DimensionScore] = Field(default_factory=list)
    composite_score: float = 0.0
    decision: Literal["loop", "advance", "escalate"] = "loop"
    decision_rationale: str = ""


# --- Critic ---


class CritiqueOutput(BaseModel):
    """Structured critique from the critic agent."""

    fatal_flaws: list[str] = Field(default_factory=list)
    major_concerns: list[str] = Field(default_factory=list)
    minor_notes: list[str] = Field(default_factory=list)
    strongest_elements: list[str] = Field(default_factory=list)
    summary: str = ""


# --- Consistency ---


class ConsistencyConflict(BaseModel):
    """A conflict found between blueprint sections."""

    section_a: str
    section_b: str
    description: str
    severity: Literal["high", "medium", "low"]


class ConsistencyReport(BaseModel):
    """Report from the consistency checker agent."""

    is_consistent: bool = True
    conflicts: list[ConsistencyConflict] = Field(default_factory=list)
    notes: str = ""


# --- Candidates ---


class CandidateOpportunity(BaseModel):
    """A raw candidate from the generator in horizon scan."""

    title: str
    problem_space: str
    target_customer: str
    why_agentic: str
    timing_signal: str
    estimated_severity: int = Field(ge=0, le=10)
    evidence: str = ""


class CandidateListOutput(BaseModel):
    """Generator output: list of candidates."""

    candidates: list[CandidateOpportunity] = Field(default_factory=list)


# --- Phase/Round Context ---


class RoundContext(BaseModel):
    """Context passed to agents each round."""

    run_id: str
    run_type: str
    phase_name: str
    round_number: int
    input_config: dict[str, Any] = Field(default_factory=dict)
    previous_rounds: list[dict[str, Any]] = Field(default_factory=list)
    locked_outputs: dict[str, Any] = Field(default_factory=dict)
    research_bundle: ResearchBundle | None = None
    lessons: list[str] = Field(default_factory=list)
    current_content: dict[str, Any] = Field(default_factory=dict)


class PhaseConfig(BaseModel):
    """Configuration for a deliberation phase."""

    phase_name: str
    agent_sequence: list[str]
    max_rounds: int = 4
    quality_threshold: float = 0.82
    rubric_key: str = ""


class PhaseResult(BaseModel):
    """Result of a completed deliberation phase."""

    phase_name: str
    final_output: dict[str, Any] = Field(default_factory=dict)
    quality_score: float = 0.0
    rounds_executed: int = 0
    decision: str = ""
    total_tokens: TokenUsage = Field(default_factory=lambda: TokenUsage())


class Decision(BaseModel):
    """Decision made after a round."""

    action: Literal["loop", "advance", "escalate"]
    rationale: str = ""
    scores: RoundScores | None = None


# --- API Response Schemas ---


class RunResponse(BaseModel):
    """API response for a run."""

    id: str
    run_type: str
    status: str
    created_at: datetime
    updated_at: datetime
    current_phase: str | None
    current_round: int
    input_config: dict[str, Any]
    metadata: dict[str, Any] = Field(default_factory=dict)


class RunListResponse(BaseModel):
    """API response for listing runs."""

    runs: list[RunResponse]
    total: int


class PhaseResponse(BaseModel):
    """API response for a phase."""

    id: str
    phase_name: str
    status: str
    round_count: int
    quality_score: float | None
    started_at: datetime | None
    completed_at: datetime | None


class RoundResponse(BaseModel):
    """API response for a round."""

    id: str
    round_number: int
    scores: dict[str, Any]
    decision: str | None
    decision_rationale: str | None
    duration_seconds: float | None


class LessonResponse(BaseModel):
    """API response for a lesson."""

    id: str
    category: str
    insight: str
    applies_to: list[str]
    created_at: datetime
