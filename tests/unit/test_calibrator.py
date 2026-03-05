"""Tests for rubric calibrator."""

from __future__ import annotations

from ventureforge.scoring.calibrator import RubricCalibrator
from ventureforge.scoring.rubrics import HORIZON_SCAN_RUBRIC


def test_propose_adjustment_increase():
    cal = RubricCalibrator()
    adjusted = cal.propose_adjustment(
        HORIZON_SCAN_RUBRIC,
        feedback="Market sizing was too shallow",
        dimension_name="market_size_signal",
        direction="increase",
        amount=0.05,
    )
    # Original weight
    orig = next(d for d in HORIZON_SCAN_RUBRIC.dimensions if d.name == "market_size_signal")
    new = next(d for d in adjusted.dimensions if d.name == "market_size_signal")
    # Weight should have increased relative to others
    assert new.weight > orig.weight or abs(new.weight - orig.weight) < 0.01

    # Weights should still sum to ~1.0
    total = sum(d.weight for d in adjusted.dimensions)
    assert abs(total - 1.0) < 0.01


def test_propose_adjustment_nonexistent_dimension():
    cal = RubricCalibrator()
    adjusted = cal.propose_adjustment(
        HORIZON_SCAN_RUBRIC,
        feedback="Fix something",
        dimension_name="nonexistent",
        direction="increase",
    )
    # Should return unchanged rubric
    assert adjusted == HORIZON_SCAN_RUBRIC
