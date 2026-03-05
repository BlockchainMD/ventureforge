"""Tests for LLM client initialization and basic logic."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from ventureforge.core.exceptions import LLMError


async def test_anthropic_client_init():
    with patch("ventureforge.llm.anthropic_client.get_settings") as mock:
        mock.return_value.anthropic_api_key = "test-key"
        from ventureforge.llm.anthropic_client import AnthropicClient
        client = AnthropicClient()
        assert client._api_key == "test-key"


async def test_anthropic_generate_json_parse_error():
    with patch("ventureforge.llm.anthropic_client.get_settings") as mock:
        mock.return_value.anthropic_api_key = "test-key"
        from ventureforge.llm.anthropic_client import AnthropicClient
        client = AnthropicClient()

        # Mock generate to return invalid JSON
        async def _mock_gen(*args, **kwargs):
            from ventureforge.core.schemas import TokenUsage
            return "not json at all", TokenUsage()

        client.generate = _mock_gen
        with pytest.raises(LLMError, match="Failed to parse JSON"):
            await client.generate_json("sys", "user")


async def test_openai_client_availability():
    with patch("ventureforge.llm.openai_client.get_settings") as mock:
        mock.return_value.openai_api_key = None
        from ventureforge.llm.openai_client import OpenAIClient
        client = OpenAIClient()
        assert not client.available

        mock.return_value.openai_api_key = "sk-test"
        client2 = OpenAIClient()
        assert client2.available


async def test_llm_router_resolve_model():
    with patch("ventureforge.llm.router.get_settings") as mock:
        mock.return_value.anthropic_api_key = ""
        mock.return_value.openai_api_key = None
        mock.return_value.gemini_api_key = ""
        mock.return_value.deep_reasoning_model = "claude-opus-4-6"
        mock.return_value.fast_model = "claude-sonnet-4-6"
        from ventureforge.llm.router import LLMRouter
        router = LLMRouter()
        # Gemini not available (no key), so falls back to Anthropic routing
        assert router.resolve_model("deep_reasoning") == "claude-opus-4-6"
        assert router.resolve_model("fast_extraction") == "claude-sonnet-4-6"
        assert router.resolve_model("custom-model") == "custom-model"
