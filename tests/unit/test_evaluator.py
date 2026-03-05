"""Tests for the scoring evaluator module."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from ventureforge.core.schemas import TokenUsage
from ventureforge.scoring.evaluator import Evaluator, evaluate_dry_run
from ventureforge.scoring.rubrics import Rubric, ScoringDimension, get_rubric


# ------------------------------------------------------------------
# evaluate_dry_run (free function)
# ------------------------------------------------------------------


def test_evaluate_dry_run_known_phase():
    scores = evaluate_dry_run("horizon_scan")
    assert scores.composite_score == 0.85
    assert scores.decision == "advance"
    assert len(scores.dimension_scores) > 0


def test_evaluate_dry_run_generic_phase():
    scores = evaluate_dry_run("some_unknown_phase")
    assert scores.composite_score == 0.85
    assert scores.decision == "advance"


# ------------------------------------------------------------------
# Evaluator._parse_scores
# ------------------------------------------------------------------


def test_parse_scores_basic():
    router = MagicMock()
    evaluator = Evaluator(router)

    rubric = Rubric(
        phase="test",
        dimensions=[
            ScoringDimension(name="quality", weight=0.5, description="Quality"),
            ScoringDimension(name="depth", weight=0.5, description="Depth"),
        ],
        advancement_threshold=0.7,
    )

    data = {
        "scores": [
            {"dimension": "quality", "score": 8.0, "evidence": "e1", "justification": "j1"},
            {"dimension": "depth", "score": 6.0, "evidence": "e2", "justification": "j2"},
        ],
        "composite_score": 7.0,
        "decision": "advance",
        "decision_rationale": "Good enough",
    }

    result = evaluator._parse_scores(data, rubric)
    assert len(result.dimension_scores) == 2
    assert result.composite_score == 0.7  # 7.0 / 10
    assert result.decision == "advance"


def test_parse_scores_clamp_values():
    """Scores should be clamped to 0-10 range."""
    router = MagicMock()
    evaluator = Evaluator(router)

    rubric = Rubric(
        phase="test",
        dimensions=[ScoringDimension(name="x", weight=1.0, description="X")],
        advancement_threshold=0.5,
    )

    data = {
        "scores": [
            {"dimension": "x", "score": 15.0, "evidence": "e", "justification": "j"},
        ],
        "composite_score": 0,
        "decision": "advance",
        "decision_rationale": "ok",
    }

    result = evaluator._parse_scores(data, rubric)
    assert result.dimension_scores[0].score == 10.0  # Clamped to max


def test_parse_scores_auto_compute_composite():
    """When composite_score is 0, it should be computed from dimensions."""
    router = MagicMock()
    evaluator = Evaluator(router)

    rubric = Rubric(
        phase="test",
        dimensions=[
            ScoringDimension(name="a", weight=0.6, description="A"),
            ScoringDimension(name="b", weight=0.4, description="B"),
        ],
        advancement_threshold=0.7,
    )

    data = {
        "scores": [
            {"dimension": "a", "score": 8.0, "evidence": "", "justification": ""},
            {"dimension": "b", "score": 6.0, "evidence": "", "justification": ""},
        ],
        "composite_score": 0,
        "decision": "advance",
        "decision_rationale": "",
    }

    result = evaluator._parse_scores(data, rubric)
    # (8*0.6 + 6*0.4) / (0.6+0.4) = 7.2 → 0.72
    assert abs(result.composite_score - 0.72) < 0.01


def test_parse_scores_invalid_decision():
    """Invalid decision should be corrected based on threshold."""
    router = MagicMock()
    evaluator = Evaluator(router)

    rubric = Rubric(
        phase="test",
        dimensions=[ScoringDimension(name="x", weight=1.0, description="X")],
        advancement_threshold=0.7,
    )

    # High score but invalid decision
    data = {
        "scores": [{"dimension": "x", "score": 9.0, "evidence": "", "justification": ""}],
        "composite_score": 9.0,
        "decision": "invalid_decision",
        "decision_rationale": "",
    }

    result = evaluator._parse_scores(data, rubric)
    assert result.decision == "advance"  # 0.9 >= 0.7

    # Low score with invalid decision
    data2 = {
        "scores": [{"dimension": "x", "score": 3.0, "evidence": "", "justification": ""}],
        "composite_score": 3.0,
        "decision": "WRONG",
        "decision_rationale": "",
    }

    result2 = evaluator._parse_scores(data2, rubric)
    assert result2.decision == "loop"  # 0.3 < 0.7


# ------------------------------------------------------------------
# Evaluator._default_scores
# ------------------------------------------------------------------


def test_default_scores():
    router = MagicMock()
    evaluator = Evaluator(router)

    rubric = Rubric(
        phase="test",
        dimensions=[
            ScoringDimension(name="a", weight=0.5, description="A"),
            ScoringDimension(name="b", weight=0.5, description="B"),
        ],
        advancement_threshold=0.7,
    )

    result = evaluator._default_scores(rubric)
    assert result.composite_score == 0.5
    assert result.decision == "loop"
    assert len(result.dimension_scores) == 2
    assert all(ds.score == 5.0 for ds in result.dimension_scores)


# ------------------------------------------------------------------
# Evaluator.evaluate (LLM path)
# ------------------------------------------------------------------


async def test_evaluate_success():
    router = MagicMock()
    router.generate_json = AsyncMock(
        return_value=(
            {
                "scores": [
                    {"dimension": "quality", "score": 8.0, "evidence": "e", "justification": "j"},
                ],
                "composite_score": 8.0,
                "decision": "advance",
                "decision_rationale": "Good",
            },
            TokenUsage(),
        )
    )

    evaluator = Evaluator(router)
    result = await evaluator.evaluate("horizon_scan", {"content": "test"})
    assert result.decision == "advance"


async def test_evaluate_llm_failure_returns_defaults():
    router = MagicMock()
    router.generate_json = AsyncMock(side_effect=Exception("LLM error"))

    evaluator = Evaluator(router)
    result = await evaluator.evaluate("horizon_scan", {"content": "test"})
    # Should return default scores, not raise
    assert result.decision == "loop"
    assert result.composite_score == 0.5


async def test_evaluate_with_custom_rubric():
    router = MagicMock()
    router.generate_json = AsyncMock(
        return_value=(
            {
                "scores": [
                    {"dimension": "custom", "score": 9.0, "evidence": "e", "justification": "j"},
                ],
                "composite_score": 9.0,
                "decision": "advance",
                "decision_rationale": "Excellent",
            },
            TokenUsage(),
        )
    )

    custom_rubric = Rubric(
        phase="custom",
        dimensions=[
            ScoringDimension(
                name="custom",
                weight=1.0,
                description="Custom dimension",
                scoring_guide={9: "excellent", 7: "good"},
            ),
        ],
        advancement_threshold=0.8,
    )

    evaluator = Evaluator(router)
    result = await evaluator.evaluate("custom", {"data": "test"}, rubric=custom_rubric)
    assert result.composite_score == 0.9
