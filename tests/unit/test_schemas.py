"""Tests for Pydantic schemas."""

from __future__ import annotations

import pytest

from ventureforge.core.schemas import (
    BuilderInput,
    CritiqueOutput,
    Decision,
    DimensionScore,
    OpportunityThesis,
    RoundContext,
    RoundScores,
    ScreenerInput,
    TokenUsage,
)


class TestScreenerInput:
    def test_defaults(self):
        si = ScreenerInput()
        assert si.domain is None
        assert si.constraints == []
        assert si.anti_patterns == []
        assert si.target_funding_stage == "pre-seed to Series A"
        assert si.geography == "US-first"
        assert si.max_candidates == 8
        assert si.max_rounds_per_phase == 4
        assert si.quality_threshold == 0.82

    def test_with_overrides(self):
        si = ScreenerInput(domain="healthtech", max_candidates=5, constraints=["B2B"])
        assert si.domain == "healthtech"
        assert si.max_candidates == 5
        assert si.constraints == ["B2B"]

    def test_exclude_opportunity_ids_default(self):
        si = ScreenerInput()
        assert si.exclude_opportunity_ids == []


class TestOpportunityThesis:
    def test_full_creation(self):
        thesis = OpportunityThesis(
            title="Test Opportunity",
            one_liner="A one-liner",
            problem_statement="The problem",
            solution_concept="The solution",
            why_now="Timing",
            why_agentic="AI needed",
            market_signal="Big market",
            moat_hypothesis="Data moat",
            biggest_risk="Competition",
        )
        assert thesis.title == "Test Opportunity"
        assert thesis.comparable_companies == []
        assert thesis.recommended_first_customer == ""

    def test_missing_required_fields_raises(self):
        with pytest.raises(Exception):
            OpportunityThesis(title="Only title")  # type: ignore[call-arg]


class TestBuilderInput:
    def test_valid_creation(self):
        thesis = OpportunityThesis(
            title="T", one_liner="O", problem_statement="P",
            solution_concept="S", why_now="W", why_agentic="A",
            market_signal="M", moat_hypothesis="H", biggest_risk="R",
        )
        bi = BuilderInput(opportunity=thesis)
        assert bi.target_audience == "seed VC"
        assert bi.depth == "investor_ready"
        assert bi.max_rounds_per_section == 3
        assert bi.quality_threshold == 0.85

    def test_invalid_depth_raises(self):
        thesis = OpportunityThesis(
            title="T", one_liner="O", problem_statement="P",
            solution_concept="S", why_now="W", why_agentic="A",
            market_signal="M", moat_hypothesis="H", biggest_risk="R",
        )
        with pytest.raises(Exception):
            BuilderInput(opportunity=thesis, depth="invalid")  # type: ignore[arg-type]

    def test_depth_options(self):
        thesis = OpportunityThesis(
            title="T", one_liner="O", problem_statement="P",
            solution_concept="S", why_now="W", why_agentic="A",
            market_signal="M", moat_hypothesis="H", biggest_risk="R",
        )
        for depth in ("mvp", "full", "investor_ready"):
            bi = BuilderInput(opportunity=thesis, depth=depth)
            assert bi.depth == depth


class TestCritiqueOutput:
    def test_defaults(self):
        co = CritiqueOutput()
        assert co.fatal_flaws == []
        assert co.major_concerns == []
        assert co.minor_notes == []
        assert co.strongest_elements == []
        assert co.summary == ""

    def test_with_data(self):
        co = CritiqueOutput(
            fatal_flaws=["No moat"],
            major_concerns=["Weak TAM"],
            summary="Needs work",
        )
        assert len(co.fatal_flaws) == 1
        assert co.summary == "Needs work"


class TestRoundScores:
    def test_defaults(self):
        rs = RoundScores()
        assert rs.dimension_scores == []
        assert rs.composite_score == 0.0
        assert rs.decision == "loop"
        assert rs.decision_rationale == ""

    def test_with_scores(self):
        ds = DimensionScore(
            dimension="quality", score=8.5, weight=0.5,
            evidence="Good", justification="Solid work",
        )
        rs = RoundScores(
            dimension_scores=[ds],
            composite_score=0.85,
            decision="advance",
        )
        assert rs.composite_score == 0.85
        assert rs.decision == "advance"

    def test_invalid_decision_raises(self):
        with pytest.raises(Exception):
            RoundScores(decision="invalid_decision")  # type: ignore[arg-type]


class TestDecision:
    def test_valid_actions(self):
        for action in ("loop", "advance", "escalate"):
            d = Decision(action=action)
            assert d.action == action

    def test_invalid_action_raises(self):
        with pytest.raises(Exception):
            Decision(action="reject")  # type: ignore[arg-type]

    def test_with_scores(self):
        scores = RoundScores(composite_score=0.9, decision="advance")
        d = Decision(action="advance", rationale="High score", scores=scores)
        assert d.scores is not None
        assert d.scores.composite_score == 0.9


class TestTokenUsage:
    def test_defaults(self):
        tu = TokenUsage()
        assert tu.input_tokens == 0
        assert tu.output_tokens == 0
        assert tu.model == ""
