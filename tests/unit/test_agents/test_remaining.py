"""Tests for remaining agents: scorer, synthesizer, gap_analyst, consistency_checker, meta_agent."""

from __future__ import annotations

from unittest.mock import MagicMock

from ventureforge.agents.base import AgentConfig
from ventureforge.agents.consistency_checker import ConsistencyCheckerAgent
from ventureforge.agents.gap_analyst import GapAnalystAgent
from ventureforge.agents.meta_agent import MetaAgent
from ventureforge.agents.scorer import ScorerAgent
from ventureforge.agents.synthesizer import SynthesizerAgent
from ventureforge.core.schemas import RoundContext


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
    return MagicMock()


async def test_scorer_dry_run():
    agent = ScorerAgent(_mock_router(), AgentConfig(name="scorer", dry_run=True))
    output = await agent.run(_make_context())
    assert output.agent_name == "scorer"
    assert "composite_score" in output.content or "decision" in output.content


async def test_synthesizer_dry_run():
    agent = SynthesizerAgent(_mock_router(), AgentConfig(name="synthesizer", dry_run=True))
    ctx = _make_context(current_content={"candidates": [{"title": "Test"}]})
    output = await agent.run(ctx)
    assert output.agent_name == "synthesizer"


async def test_gap_analyst_dry_run():
    agent = GapAnalystAgent(_mock_router(), AgentConfig(name="gap_analyst", dry_run=True))
    output = await agent.run(_make_context())
    assert output.agent_name == "gap_analyst"
    assert "analyses" in output.content or "gap" in str(output.content).lower()


async def test_consistency_checker_dry_run():
    agent = ConsistencyCheckerAgent(
        _mock_router(), AgentConfig(name="consistency_checker", dry_run=True)
    )
    ctx = _make_context(run_type="builder", phase_name="market_sizing")
    output = await agent.run(ctx)
    assert output.agent_name == "consistency_checker"
    assert output.content.get("is_consistent") is True


async def test_meta_agent_dry_run():
    agent = MetaAgent(_mock_router(), AgentConfig(name="meta_agent", dry_run=True))
    output = await agent.run(_make_context())
    assert output.agent_name == "meta_agent"
    assert "retrospective" in str(output.content).lower() or "patterns" in str(output.content).lower()
