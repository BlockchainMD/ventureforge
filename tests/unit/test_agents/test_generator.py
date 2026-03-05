"""Tests for GeneratorAgent."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from ventureforge.agents.base import AgentConfig
from ventureforge.agents.generator import GeneratorAgent
from ventureforge.core.schemas import AgentOutput, RoundContext, TokenUsage


@pytest.fixture
def generator_dry() -> GeneratorAgent:
    config = AgentConfig(name="generator", dry_run=True)
    mock_router = MagicMock()
    with patch("ventureforge.agents.base.get_registry"):
        return GeneratorAgent(llm_router=mock_router, config=config)


@pytest.fixture
def screener_context() -> RoundContext:
    return RoundContext(
        run_id="run-001",
        run_type="screener",
        phase_name="horizon_scan",
        round_number=1,
        input_config={"domain": "fintech", "constraints": ["B2B only"]},
    )


@pytest.fixture
def builder_context() -> RoundContext:
    return RoundContext(
        run_id="run-002",
        run_type="builder",
        phase_name="problem_statement",
        round_number=1,
        input_config={
            "opportunity": {"title": "Test"},
            "founder_context": "Solo founder",
        },
    )


class TestGeneratorDryRun:
    async def test_dry_run_returns_agent_output(
        self, generator_dry: GeneratorAgent, screener_context: RoundContext
    ):
        result = await generator_dry.run(screener_context)
        assert isinstance(result, AgentOutput)
        assert result.agent_name == "generator"

    async def test_dry_run_has_candidates(
        self, generator_dry: GeneratorAgent, screener_context: RoundContext
    ):
        result = await generator_dry.run(screener_context)
        candidates = result.content.get("candidates", [])
        assert len(candidates) == 5
        assert all("title" in c for c in candidates)

    async def test_dry_run_token_usage_is_zero(
        self, generator_dry: GeneratorAgent, screener_context: RoundContext
    ):
        result = await generator_dry.run(screener_context)
        assert result.token_usage.input_tokens == 0
        assert result.token_usage.model == "dry-run"

    async def test_dry_run_raw_text_mentions_dry_run(
        self, generator_dry: GeneratorAgent, screener_context: RoundContext
    ):
        result = await generator_dry.run(screener_context)
        assert "dry-run" in result.raw_text.lower()


class TestGeneratorWithMockedLLM:
    async def test_run_screener_calls_generate_json(self, screener_context: RoundContext):
        mock_router = MagicMock()
        mock_usage = TokenUsage(input_tokens=500, output_tokens=1000, model="claude-opus-4-6")
        mock_result = {"candidates": [{"title": "Test Idea", "problem_space": "testing"}]}
        mock_router.generate_json = AsyncMock(return_value=(mock_result, mock_usage))

        config = AgentConfig(name="generator", dry_run=False)
        mock_registry = MagicMock()
        mock_template = MagicMock()
        mock_template.model_hint = "deep_reasoning"
        mock_template.max_tokens = 4096
        mock_template.temperature = 0.7
        mock_registry.get.return_value = mock_template
        mock_template.render_system = MagicMock(return_value="system")
        mock_template.render_user = MagicMock(return_value="user")

        with patch("ventureforge.agents.base.get_registry", return_value=mock_registry):
            agent = GeneratorAgent(llm_router=mock_router, config=config)

        result = await agent.run(screener_context)
        assert result.content == mock_result
        assert result.token_usage.input_tokens == 500
        mock_router.generate_json.assert_awaited_once()

    async def test_run_builder_uses_builder_template(self, builder_context: RoundContext):
        mock_router = MagicMock()
        mock_usage = TokenUsage(input_tokens=200, output_tokens=800, model="claude-opus-4-6")
        mock_result = {"draft": "Some section content"}
        mock_router.generate_json = AsyncMock(return_value=(mock_result, mock_usage))

        config = AgentConfig(name="generator", dry_run=False)
        mock_registry = MagicMock()
        mock_template = MagicMock()
        mock_template.model_hint = "deep_reasoning"
        mock_template.max_tokens = 4096
        mock_template.temperature = 0.7
        mock_registry.get.return_value = mock_template
        mock_template.render_system = MagicMock(return_value="system")
        mock_template.render_user = MagicMock(return_value="user")

        with patch("ventureforge.agents.base.get_registry", return_value=mock_registry):
            agent = GeneratorAgent(llm_router=mock_router, config=config)

        result = await agent.run(builder_context)
        assert result.content == mock_result
        # Verify the template key used was for builder
        mock_registry.get.assert_called_with("builder.problem_statement.generator")
