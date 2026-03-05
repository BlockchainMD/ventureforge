"""Tests for screener horizon_scan helpers."""

from __future__ import annotations

import pytest

from ventureforge.screener.horizon_scan import build_horizon_scan_context, filter_shortlist


class TestBuildHorizonScanContext:
    def test_default_domain_when_none(self):
        ctx = build_horizon_scan_context(
            domain=None, constraints=[], anti_patterns=[], excluded_opportunities=[]
        )
        assert "open exploration" in ctx["domain"]

    def test_explicit_domain(self):
        ctx = build_horizon_scan_context(
            domain="fintech", constraints=[], anti_patterns=[], excluded_opportunities=[]
        )
        assert ctx["domain"] == "fintech"

    def test_constraints_joined(self):
        ctx = build_horizon_scan_context(
            domain="test",
            constraints=["B2B only", "no hardware"],
            anti_patterns=[],
            excluded_opportunities=[],
        )
        assert "B2B only" in ctx["constraints"]
        assert "no hardware" in ctx["constraints"]

    def test_anti_patterns_joined(self):
        ctx = build_horizon_scan_context(
            domain="test",
            constraints=[],
            anti_patterns=["crypto", "NFT"],
            excluded_opportunities=[],
        )
        assert "crypto" in ctx["anti_patterns"]

    def test_lessons_formatted(self):
        ctx = build_horizon_scan_context(
            domain="test",
            constraints=[],
            anti_patterns=[],
            excluded_opportunities=[],
            lessons=["Focus on B2B", "Avoid crowded markets"],
        )
        assert "- Focus on B2B" in ctx["lessons"]
        assert "- Avoid crowded markets" in ctx["lessons"]

    def test_candidate_count(self):
        ctx = build_horizon_scan_context(
            domain="test",
            constraints=[],
            anti_patterns=[],
            excluded_opportunities=[],
            candidate_count=30,
        )
        assert ctx["candidate_count"] == "30"

    def test_excluded_opportunities_formatted(self):
        ctx = build_horizon_scan_context(
            domain="test",
            constraints=[],
            anti_patterns=[],
            excluded_opportunities=["opp-1", "opp-2"],
        )
        assert "opp-1" in ctx["excluded_opportunities"]


class TestFilterShortlist:
    def test_filters_by_min_score(self):
        candidates = [
            {"title": "A", "composite_score": 8.0},
            {"title": "B", "composite_score": 5.0},
            {"title": "C", "composite_score": 7.0},
        ]
        result = filter_shortlist(candidates, max_candidates=10, min_score=6.5)
        assert len(result) == 2
        titles = [c["title"] for c in result]
        assert "B" not in titles

    def test_limits_to_max_candidates(self):
        candidates = [{"title": f"C{i}", "composite_score": 9.0} for i in range(20)]
        result = filter_shortlist(candidates, max_candidates=5, min_score=0)
        assert len(result) == 5

    def test_sorted_descending(self):
        candidates = [
            {"title": "Low", "composite_score": 7.0},
            {"title": "High", "composite_score": 9.5},
            {"title": "Mid", "composite_score": 8.0},
        ]
        result = filter_shortlist(candidates, max_candidates=10, min_score=6.0)
        assert result[0]["title"] == "High"
        assert result[-1]["title"] == "Low"

    def test_empty_input(self):
        assert filter_shortlist([], max_candidates=8, min_score=6.5) == []

    def test_no_candidates_above_threshold(self):
        candidates = [{"title": "X", "composite_score": 3.0}]
        result = filter_shortlist(candidates, min_score=6.5)
        assert result == []
