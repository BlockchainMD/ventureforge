"""Tests for agent non-dry-run (live) paths with mocked LLM."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from ventureforge.agents.base import AgentConfig, BaseAgent
from ventureforge.core.schemas import (
    AgentOutput,
    CritiqueOutput,
    RoundContext,
    TokenUsage,
)


def _make_context(**kwargs) -> RoundContext:
    defaults = {
        "run_id": "test",
        "run_type": "screener",
        "phase_name": "horizon_scan",
        "round_number": 1,
    }
    defaults.update(kwargs)
    return RoundContext(**defaults)


def _mock_router():
    router = MagicMock()
    router.generate_json = AsyncMock()
    return router


# ------------------------------------------------------------------
# BaseAgent._parse_output
# ------------------------------------------------------------------


def test_parse_output_success():
    """Test _parse_output with valid data."""
    from pydantic import BaseModel

    class SimpleModel(BaseModel):
        value: int

    agent = MagicMock(spec=BaseAgent)
    agent.name = "test"
    result = BaseAgent._parse_output(agent, {"value": 42}, SimpleModel)
    assert result.value == 42


def test_parse_output_failure_exhausts_retries():
    """Test _parse_output raises AgentParseError after retries."""
    from pydantic import BaseModel

    from ventureforge.core.exceptions import AgentParseError

    class StrictModel(BaseModel):
        required_field: int

    agent = MagicMock(spec=BaseAgent)
    agent.name = "test"
    with pytest.raises((AgentParseError, Exception)):
        BaseAgent._parse_output(agent, {"wrong": "data"}, StrictModel, retries_left=0)


# ------------------------------------------------------------------
# CriticAgent live path
# ------------------------------------------------------------------


async def test_critic_live_run():
    from ventureforge.agents.critic import CriticAgent

    router = _mock_router()
    critique_data = {
        "fatal_flaws": ["flaw1"],
        "major_concerns": ["concern1"],
        "minor_notes": [],
        "strongest_elements": ["strength1"],
        "summary": "Test summary",
    }

    template = MagicMock()
    template.render_system.return_value = "sys"
    template.render_user.return_value = "user"
    template.model_hint = "fast"
    template.max_tokens = 2000
    template.temperature = 0.7

    router.generate_json = AsyncMock(return_value=(critique_data, TokenUsage()))

    agent = CriticAgent(router, AgentConfig(name="critic", dry_run=False))
    agent._registry = MagicMock()
    agent._registry.get.return_value = template

    ctx = _make_context()
    output = await agent.run(ctx)
    assert output.agent_name == "critic"
    assert output.content["fatal_flaws"] == ["flaw1"]


async def test_critic_archetype_rotation():
    from ventureforge.agents.critic import CriticAgent, _VC_ARCHETYPES

    agent = CriticAgent(_mock_router(), AgentConfig(name="critic"))
    for i in range(4):
        ctx = _make_context(round_number=i)
        archetype = agent._select_archetype(ctx)
        assert archetype["name"] == _VC_ARCHETYPES[i % 4]["name"]


async def test_critic_resolve_template():
    from ventureforge.agents.critic import CriticAgent

    agent = CriticAgent(_mock_router(), AgentConfig(name="critic"))
    ctx_screener = _make_context(run_type="screener", phase_name="horizon_scan")
    assert agent._resolve_template(ctx_screener) == "screener.horizon_scan.critic"

    ctx_builder = _make_context(run_type="builder", phase_name="market_sizing")
    assert agent._resolve_template(ctx_builder) == "builder.market_sizing.critic"


# ------------------------------------------------------------------
# SynthesizerAgent live path
# ------------------------------------------------------------------


async def test_synthesizer_live_run():
    from ventureforge.agents.synthesizer import SynthesizerAgent

    router = _mock_router()
    template = MagicMock()
    template.render_system.return_value = "sys"
    template.render_user.return_value = "user"
    template.model_hint = "deep_reasoning"
    template.max_tokens = 4000
    template.temperature = 0.7

    router.generate_json = AsyncMock(
        return_value=({"synthesized": "content"}, TokenUsage())
    )

    agent = SynthesizerAgent(router, AgentConfig(name="synthesizer", dry_run=False))
    agent._registry = MagicMock()
    agent._registry.get.return_value = template

    ctx = _make_context(current_content={"candidates": [{"title": "Test"}]})
    output = await agent.run(ctx)
    assert output.agent_name == "synthesizer"
    assert "synthesized" in output.content


async def test_synthesizer_resolve_template():
    from ventureforge.agents.synthesizer import SynthesizerAgent

    agent = SynthesizerAgent(_mock_router(), AgentConfig(name="synthesizer"))
    ctx = _make_context(run_type="builder", phase_name="go_to_market")
    assert agent._resolve_template(ctx) == "builder.go_to_market.synthesizer"


async def test_synthesizer_extract_latest_critique():
    from ventureforge.agents.synthesizer import SynthesizerAgent

    agent = SynthesizerAgent(_mock_router(), AgentConfig(name="synthesizer"))
    ctx = _make_context(
        previous_rounds=[
            {"agent_outputs": {"critic": {"content": {"summary": "round1"}}}},
            {"agent_outputs": {"critic": {"content": {"summary": "round2"}}}},
        ]
    )
    critique = agent._extract_latest_critique(ctx)
    assert critique["summary"] == "round2"

    # No critique available
    ctx2 = _make_context(previous_rounds=[{"agent_outputs": {}}])
    assert agent._extract_latest_critique(ctx2) == {}


# ------------------------------------------------------------------
# ScorerAgent live path
# ------------------------------------------------------------------


async def test_scorer_live_run():
    from ventureforge.agents.scorer import ScorerAgent

    router = _mock_router()
    score_data = {
        "dimension_scores": [
            {"dimension": "quality", "score": 8.0, "weight": 1.0,
             "evidence": "good", "justification": "solid"}
        ],
        "composite_score": 0.8,
        "decision": "advance",
        "decision_rationale": "Good enough",
    }

    template = MagicMock()
    template.render_system.return_value = "sys"
    template.render_user.return_value = "user"
    template.model_hint = "fast"
    template.max_tokens = 2000
    template.temperature = 0.3

    router.generate_json = AsyncMock(return_value=(score_data, TokenUsage()))

    agent = ScorerAgent(router, AgentConfig(name="scorer", dry_run=False))
    agent._registry = MagicMock()
    agent._registry.get.return_value = template

    ctx = _make_context()
    output = await agent.run(ctx)
    assert output.content["decision"] == "advance"


async def test_scorer_resolve_template():
    from ventureforge.agents.scorer import ScorerAgent

    agent = ScorerAgent(_mock_router(), AgentConfig(name="scorer"))
    ctx = _make_context(run_type="screener", phase_name="deep_dive")
    assert agent._resolve_template(ctx) == "screener.deep_dive.scorer"

    ctx2 = _make_context(run_type="builder", phase_name="market_sizing")
    assert agent._resolve_template(ctx2) == "builder.market_sizing.scorer"


# ------------------------------------------------------------------
# ResearcherAgent live path
# ------------------------------------------------------------------


async def test_researcher_live_run():
    from ventureforge.agents.researcher import ResearcherAgent
    from ventureforge.core.schemas import ResearchBundle, ResearchInsight

    router = _mock_router()
    agent = ResearcherAgent(router, AgentConfig(name="researcher", dry_run=False))

    mock_bundle = ResearchBundle(
        query="test query",
        insights=[
            ResearchInsight(
                claim="Market growing",
                confidence="high",
                source_url="https://example.com",
                category="market_size",
            )
        ],
        raw_results=[{"url": "https://example.com", "content": "data"}],
    )

    agent._research_engine = MagicMock()
    agent._research_engine.research_topic = AsyncMock(return_value=mock_bundle)

    ctx = _make_context(
        input_config={"domain": "fintech"},
        current_content={"candidates": [{"title": "Test", "problem_space": "compliance"}]},
    )
    output = await agent.run(ctx)
    assert output.agent_name == "researcher"
    assert len(output.content["insights"]) == 1


async def test_researcher_build_queries_screener():
    from ventureforge.agents.researcher import ResearcherAgent

    agent = ResearcherAgent(_mock_router(), AgentConfig(name="researcher"))
    ctx = _make_context(
        run_type="screener",
        input_config={"domain": "healthcare"},
        current_content={"candidates": [{"title": "MedAI", "problem_space": "diagnostics"}]},
    )
    queries = agent._build_queries(ctx)
    assert len(queries) >= 3
    assert any("healthcare" in q for q in queries)


async def test_researcher_build_queries_builder():
    from ventureforge.agents.researcher import ResearcherAgent

    agent = ResearcherAgent(_mock_router(), AgentConfig(name="researcher"))
    ctx = _make_context(
        run_type="builder",
        phase_name="market_analysis",
        input_config={"opportunity": {"title": "TestCo", "problem_statement": "Pain"}},
    )
    queries = agent._build_queries(ctx)
    assert any("TestCo" in q for q in queries)


# ------------------------------------------------------------------
# MetaAgent live path
# ------------------------------------------------------------------


async def test_meta_agent_live_run():
    from ventureforge.agents.meta_agent import MetaAgent

    router = _mock_router()
    result_data = {
        "retrospective_summary": "Good run",
        "proposed_lessons": [{"category": "process", "insight": "do X"}],
        "prompt_improvements": [],
    }

    template = MagicMock()
    template.render_system.return_value = "sys"
    template.render_user.return_value = "user"
    template.model_hint = "deep_reasoning"
    template.max_tokens = 4000
    template.temperature = 0.7

    router.generate_json = AsyncMock(return_value=(result_data, TokenUsage()))

    agent = MetaAgent(router, AgentConfig(name="meta_agent", dry_run=False))
    agent._registry = MagicMock()
    agent._registry.get.return_value = template

    ctx = _make_context(previous_rounds=[{"round": 1}])
    output = await agent.run(ctx)
    assert output.agent_name == "meta_agent"
    assert "retrospective_summary" in output.content


# ------------------------------------------------------------------
# ConsistencyCheckerAgent live path
# ------------------------------------------------------------------


async def test_consistency_checker_no_locked_outputs():
    from ventureforge.agents.consistency_checker import ConsistencyCheckerAgent

    agent = ConsistencyCheckerAgent(
        _mock_router(), AgentConfig(name="consistency_checker", dry_run=False)
    )
    ctx = _make_context(run_type="builder", phase_name="market_sizing", locked_outputs={})
    output = await agent.run(ctx)
    assert output.content["is_consistent"] is True


async def test_consistency_checker_with_locked_outputs():
    from ventureforge.agents.consistency_checker import ConsistencyCheckerAgent

    router = _mock_router()
    report_data = {
        "is_consistent": False,
        "conflicts": [
            {
                "section_a": "problem_statement",
                "section_b": "market_sizing",
                "description": "TAM mismatch",
                "severity": "high",
            }
        ],
        "notes": "Found conflict",
    }

    template = MagicMock()
    template.render_system.return_value = "sys"
    template.render_user.return_value = "user"
    template.model_hint = "fast"
    template.max_tokens = 2000
    template.temperature = 0.3

    router.generate_json = AsyncMock(return_value=(report_data, TokenUsage()))

    agent = ConsistencyCheckerAgent(
        router, AgentConfig(name="consistency_checker", dry_run=False)
    )
    agent._registry = MagicMock()
    agent._registry.get.return_value = template

    ctx = _make_context(
        run_type="builder",
        phase_name="market_sizing",
        locked_outputs={"problem_statement": {"content": "data"}},
    )
    output = await agent.run(ctx)
    assert output.content["is_consistent"] is False
    assert len(output.content["conflicts"]) == 1


async def test_consistency_checker_parse_report():
    from ventureforge.agents.consistency_checker import ConsistencyCheckerAgent

    agent = ConsistencyCheckerAgent(
        _mock_router(), AgentConfig(name="consistency_checker")
    )
    raw = {
        "is_consistent": True,
        "conflicts": [],
        "notes": "All good",
    }
    report = agent._parse_report(raw)
    assert report.is_consistent is True
    assert report.notes == "All good"
