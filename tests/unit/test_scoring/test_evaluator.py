"""Tests for scoring evaluator."""

from __future__ import annotations

import pytest

from ventureforge.core.schemas import DimensionScore, RoundScores
from ventureforge.scoring.evaluator import evaluate_dry_run
from ventureforge.scoring.rubrics import get_rubric


class TestEvaluateDryRun:
    def test_returns_round_scores(self):
        scores = evaluate_dry_run("horizon_scan")
        assert isinstance(scores, RoundScores)

    def test_composite_score_is_valid(self):
        scores = evaluate_dry_run("horizon_scan")
        assert 0.0 <= scores.composite_score <= 1.0

    def test_decision_is_advance(self):
        scores = evaluate_dry_run("horizon_scan")
        assert scores.decision == "advance"

    def test_dimension_scores_match_rubric(self):
        phase = "horizon_scan"
        rubric = get_rubric(phase)
        scores = evaluate_dry_run(phase)
        rubric_dims = {d.name for d in rubric.dimensions}
        score_dims = {ds.dimension for ds in scores.dimension_scores}
        assert score_dims == rubric_dims

    def test_dimension_scores_have_expected_values(self):
        scores = evaluate_dry_run("horizon_scan")
        for ds in scores.dimension_scores:
            assert isinstance(ds, DimensionScore)
            assert ds.score == 7.5
            assert ds.weight > 0
            assert "dry run" in ds.evidence.lower() or "Dry run" in ds.evidence

    def test_works_for_unknown_phase(self):
        # Should use generic builder rubric
        scores = evaluate_dry_run("unknown_section")
        assert isinstance(scores, RoundScores)
        assert scores.decision == "advance"

    def test_decision_rationale_present(self):
        scores = evaluate_dry_run("horizon_scan")
        assert scores.decision_rationale != ""
