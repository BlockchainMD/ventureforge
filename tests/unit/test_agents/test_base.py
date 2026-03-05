"""Tests for BaseAgent fundamentals."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from pydantic import BaseModel

from ventureforge.agents.base import AgentConfig, BaseAgent
from ventureforge.core.exceptions import AgentParseError
from ventureforge.core.schemas import AgentOutput, RoundContext, TokenUsage


# --- Concrete subclass for testing the abstract base ---

class _StubAgent(BaseAgent):
    """Minimal concrete agent for testing BaseAgent methods."""

    async def run(self, context: RoundContext) -> AgentOutput:
        return self._get_dry_run_output(context)

    def _get_dry_run_output(self, context: RoundContext) -> AgentOutput:
        return self._make_output(content={"stub": True})


class _SampleSchema(BaseModel):
    name: str
    value: int


# --- Fixtures ---

@pytest.fixture
def agent_config() -> AgentConfig:
    return AgentConfig(name="test_agent", dry_run=True, max_parse_retries=2)


@pytest.fixture
def stub_agent(agent_config: AgentConfig) -> _StubAgent:
    mock_router = MagicMock()
    with patch("ventureforge.agents.base.get_registry"):
        return _StubAgent(llm_router=mock_router, config=agent_config)


# --- AgentConfig tests ---

class TestAgentConfig:
    def test_creation_with_defaults(self):
        config = AgentConfig(name="my_agent")
        assert config.name == "my_agent"
        assert config.dry_run is False
        assert config.max_parse_retries == 3

    def test_creation_with_overrides(self):
        config = AgentConfig(name="critic", dry_run=True, max_parse_retries=5)
        assert config.name == "critic"
        assert config.dry_run is True
        assert config.max_parse_retries == 5

    def test_name_is_required(self):
        with pytest.raises(Exception):
            AgentConfig()  # type: ignore[call-arg]


# --- _make_output tests ---

class TestMakeOutput:
    def test_make_output_minimal(self, stub_agent: _StubAgent):
        output = stub_agent._make_output(content={"key": "val"})
        assert isinstance(output, AgentOutput)
        assert output.agent_name == "test_agent"
        assert output.content == {"key": "val"}
        assert output.raw_text == ""
        assert output.token_usage.input_tokens == 0

    def test_make_output_with_usage(self, stub_agent: _StubAgent):
        usage = TokenUsage(input_tokens=100, output_tokens=50, model="claude-sonnet-4-6")
        output = stub_agent._make_output(
            content={"data": 1},
            usage=usage,
            duration=1.5,
            raw_text="hello",
        )
        assert output.token_usage.input_tokens == 100
        assert output.duration_seconds == 1.5
        assert output.raw_text == "hello"


# --- _parse_output tests ---

class TestParseOutput:
    def test_parse_valid_data(self, stub_agent: _StubAgent):
        result = stub_agent._parse_output(
            {"name": "foo", "value": 42}, _SampleSchema
        )
        assert isinstance(result, _SampleSchema)
        assert result.name == "foo"
        assert result.value == 42

    def test_parse_invalid_data_exhausts_retries(self, stub_agent: _StubAgent):
        with pytest.raises(AgentParseError, match="failed to parse"):
            stub_agent._parse_output(
                {"name": "foo", "value": "not_an_int"}, _SampleSchema, retries_left=0
            )

    def test_parse_missing_required_field_raises(self, stub_agent: _StubAgent):
        with pytest.raises(AgentParseError):
            stub_agent._parse_output({"name": "foo"}, _SampleSchema, retries_left=0)

    def test_properties(self, stub_agent: _StubAgent):
        assert stub_agent.name == "test_agent"
        assert stub_agent.dry_run is True
