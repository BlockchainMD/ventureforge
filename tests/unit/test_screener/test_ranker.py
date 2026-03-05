"""Tests for screener ranker module."""

from __future__ import annotations

import pytest

from ventureforge.screener.ranker import build_thesis_context, rank_opportunities


class TestRankOpportunities:
    def test_computes_composite_scores(self):
        candidates = [
            {
                "title": "A",
                "scores": {
                    "problem_severity": 8,
                    "ai_necessity": 7,
                    "market_size_signal": 6,
                    "timing_signal": 9,
                    "moat_potential": 5,
                },
            },
        ]
        ranked = rank_opportunities(candidates)
        assert ranked[0]["composite_score"] > 0
        assert ranked[0]["composite_score"] <= 1.0

    def test_ranked_descending(self):
        candidates = [
            {"title": "Low", "scores": {"problem_severity": 2, "ai_necessity": 2}},
            {"title": "High", "scores": {"problem_severity": 10, "ai_necessity": 10}},
        ]
        ranked = rank_opportunities(candidates)
        assert ranked[0]["title"] == "High"
        assert ranked[1]["title"] == "Low"

    def test_assigns_rank_numbers(self):
        candidates = [
            {"title": f"C{i}", "scores": {"problem_severity": 10 - i}}
            for i in range(5)
        ]
        ranked = rank_opportunities(candidates)
        for i, c in enumerate(ranked):
            assert c["rank"] == i + 1

    def test_custom_weights(self):
        candidates = [
            {"title": "A", "scores": {"custom_dim": 10}},
        ]
        ranked = rank_opportunities(candidates, weights={"custom_dim": 1.0})
        assert ranked[0]["composite_score"] == 1.0

    def test_empty_candidates(self):
        assert rank_opportunities([]) == []

    def test_missing_score_dimensions_default_to_zero(self):
        candidates = [{"title": "X", "scores": {}}]
        ranked = rank_opportunities(candidates)
        assert ranked[0]["composite_score"] == 0.0


class TestBuildThesisContext:
    def test_builds_context_dict(self):
        result = build_thesis_context(
            top_candidate={"title": "My Idea", "problem_space": "testing", "scores": {"a": 1}},
            research_data={"findings": []},
            gap_analysis={"gaps": []},
            critique={"summary": "good"},
        )
        assert result["title"] == "My Idea"
        assert result["problem_space"] == "testing"
        assert "findings" in result["research_data"]

    def test_missing_fields_default_to_empty(self):
        result = build_thesis_context(
            top_candidate={},
            research_data={},
            gap_analysis={},
            critique={},
        )
        assert result["title"] == ""
        assert result["problem_space"] == ""

    def test_scores_converted_to_string(self):
        result = build_thesis_context(
            top_candidate={"scores": {"a": 8}},
            research_data={},
            gap_analysis={},
            critique={},
        )
        assert isinstance(result["scores"], str)
