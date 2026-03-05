"""Tests for scoring rubrics."""

from __future__ import annotations

import pytest

from ventureforge.scoring.rubrics import (
    GENERIC_BUILDER_RUBRIC,
    HORIZON_SCAN_RUBRIC,
    RUBRIC_REGISTRY,
    Rubric,
    ScoringDimension,
    get_rubric,
)


class TestGetRubric:
    def test_known_phase_returns_specific_rubric(self):
        rubric = get_rubric("horizon_scan")
        assert rubric.phase == "horizon_scan"
        assert rubric is HORIZON_SCAN_RUBRIC

    def test_unknown_phase_falls_back_to_generic(self):
        rubric = get_rubric("nonexistent_phase")
        assert rubric is GENERIC_BUILDER_RUBRIC

    def test_all_registered_phases(self):
        for phase_name in RUBRIC_REGISTRY:
            rubric = get_rubric(phase_name)
            assert rubric.phase == phase_name


class TestDimensionWeights:
    @pytest.mark.parametrize("phase_name", list(RUBRIC_REGISTRY.keys()))
    def test_weights_sum_approximately_one(self, phase_name: str):
        rubric = get_rubric(phase_name)
        total = sum(d.weight for d in rubric.dimensions)
        assert abs(total - 1.0) < 0.01, f"{phase_name} weights sum to {total}"

    def test_generic_builder_weights_sum_to_one(self):
        total = sum(d.weight for d in GENERIC_BUILDER_RUBRIC.dimensions)
        assert abs(total - 1.0) < 0.01


class TestHorizonScanRubric:
    def test_has_five_dimensions(self):
        assert len(HORIZON_SCAN_RUBRIC.dimensions) == 5

    def test_dimension_names(self):
        names = {d.name for d in HORIZON_SCAN_RUBRIC.dimensions}
        expected = {
            "problem_severity",
            "ai_necessity",
            "market_size_signal",
            "timing_signal",
            "moat_potential",
        }
        assert names == expected

    def test_advancement_threshold(self):
        assert HORIZON_SCAN_RUBRIC.advancement_threshold == 0.82

    def test_max_rounds(self):
        assert HORIZON_SCAN_RUBRIC.max_rounds == 4

    def test_scoring_guides_present(self):
        for dim in HORIZON_SCAN_RUBRIC.dimensions:
            assert len(dim.scoring_guide) > 0, f"{dim.name} has no scoring guide"


class TestRubricModel:
    def test_create_custom_rubric(self):
        rubric = Rubric(
            phase="custom",
            dimensions=[
                ScoringDimension(name="quality", weight=0.5, description="Quality"),
                ScoringDimension(name="speed", weight=0.5, description="Speed"),
            ],
        )
        assert rubric.phase == "custom"
        assert len(rubric.dimensions) == 2
        assert rubric.advancement_threshold == 0.82  # default
