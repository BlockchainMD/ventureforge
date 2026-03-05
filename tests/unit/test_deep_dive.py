"""Tests for screener deep dive and whitespace modules."""

from __future__ import annotations

from ventureforge.screener.deep_dive import build_competitive_landscape, build_research_queries
from ventureforge.screener.whitespace import build_gap_analysis_context, score_ai_moat


def test_build_research_queries():
    queries = build_research_queries("Test Opp", "healthcare billing")
    assert len(queries) == 5
    assert any("healthcare billing" in q for q in queries)


def test_build_competitive_landscape():
    research = {
        "insights": [
            {"category": "competitor", "claim": "CompA exists", "source_url": "http://example.com"},
            {"category": "market_size", "claim": "$10B market", "source_url": "http://example.com"},
            {"category": "customer_pain", "claim": "Users hate X", "source_url": "http://example.com"},
        ]
    }
    landscape = build_competitive_landscape("Test", research)
    assert len(landscape["competitors"]) == 1
    assert len(landscape["market_size_signals"]) == 1
    assert len(landscape["customer_complaints"]) == 1


def test_build_gap_analysis_context():
    ctx = build_gap_analysis_context(
        {"title": "Test", "problem_space": "billing"},
        {"insights": []},
        {"competitors": []},
    )
    assert ctx["opportunity_title"] == "Test"
    assert ctx["problem_space"] == "billing"


def test_score_ai_moat():
    assert score_ai_moat({"ai_moat_score": 8}) == 8.0
    assert score_ai_moat({"ai_moat_score": 15}) == 10.0
    assert score_ai_moat({"ai_moat_score": -5}) == 0.0
    assert score_ai_moat({}) == 0.0
    assert score_ai_moat({"ai_moat_score": "bad"}) == 0.0
