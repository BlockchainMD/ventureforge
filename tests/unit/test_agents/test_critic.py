"""Tests for CriticAgent."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from ventureforge.agents.base import AgentConfig
from ventureforge.agents.critic import CriticAgent, _VC_ARCHETYPES
from ventureforge.core.schemas import AgentOutput, CritiqueOutput, RoundContext, TokenUsage


@pytest.fixture
def critic_dry() -> CriticAgent:
    config = AgentConfig(name="critic", dry_run=True)
    mock_router = MagicMock()
    with patch("ventureforge.agents.base.get_registry"):
        return CriticAgent(llm_router=mock_router, config=config)


@pytest.fixture
def context() -> RoundContext:
    return RoundContext(
        run_id="run-001",
        run_type="screener",
        phase_name="horizon_scan",
        round_number=0,
        current_content={"candidates": [{"title": "Test"}]},
    )


class TestCriticDryRun:
    async def test_dry_run_returns_agent_output(
        self, critic_dry: CriticAgent, context: RoundContext
    ):
        result = await critic_dry.run(context)
        assert isinstance(result, AgentOutput)
        assert result.agent_name == "critic"

    async def test_dry_run_has_critique_structure(
        self, critic_dry: CriticAgent, context: RoundContext
    ):
        result = await critic_dry.run(context)
        content = result.content
        assert "fatal_flaws" in content
        assert "major_concerns" in content
        assert "minor_notes" in content
        assert "strongest_elements" in content
        assert "summary" in content

    async def test_dry_run_content_validates_as_critique_output(
        self, critic_dry: CriticAgent, context: RoundContext
    ):
        result = await critic_dry.run(context)
        critique = CritiqueOutput.model_validate(result.content)
        assert len(critique.fatal_flaws) >= 1
        assert len(critique.major_concerns) >= 1
        assert len(critique.strongest_elements) >= 1
        assert critique.summary != ""

    async def test_dry_run_token_usage(
        self, critic_dry: CriticAgent, context: RoundContext
    ):
        result = await critic_dry.run(context)
        assert result.token_usage.model == "dry-run"
        assert result.duration_seconds == 0.0


class TestCriticArchetypeRotation:
    def test_archetype_rotates_by_round(self, critic_dry: CriticAgent):
        for i in range(len(_VC_ARCHETYPES)):
            ctx = RoundContext(
                run_id="run-001",
                run_type="screener",
                phase_name="horizon_scan",
                round_number=i,
            )
            archetype = critic_dry._select_archetype(ctx)
            assert archetype["name"] == _VC_ARCHETYPES[i]["name"]

    def test_archetype_wraps_around(self, critic_dry: CriticAgent):
        ctx = RoundContext(
            run_id="run-001",
            run_type="screener",
            phase_name="horizon_scan",
            round_number=len(_VC_ARCHETYPES),
        )
        archetype = critic_dry._select_archetype(ctx)
        assert archetype["name"] == _VC_ARCHETYPES[0]["name"]


class TestCriticTemplateResolution:
    def test_screener_template(self, critic_dry: CriticAgent):
        ctx = RoundContext(
            run_id="r", run_type="screener", phase_name="deep_dive", round_number=0
        )
        assert critic_dry._resolve_template(ctx) == "screener.deep_dive.critic"

    def test_builder_template(self, critic_dry: CriticAgent):
        ctx = RoundContext(
            run_id="r", run_type="builder", phase_name="market_sizing", round_number=0
        )
        assert critic_dry._resolve_template(ctx) == "builder.market_sizing.critic"
