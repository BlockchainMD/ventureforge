"""Tests for LLMRouter.resolve_model."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from ventureforge.llm.router import ANTHROPIC_MODEL_ROUTING, GEMINI_MODEL_ROUTING, LLMRouter


@pytest.fixture
def router() -> LLMRouter:
    with patch("ventureforge.llm.router.get_settings") as mock_settings, \
         patch("ventureforge.llm.router.AnthropicClient"), \
         patch("ventureforge.llm.router.OpenAIClient"), \
         patch("ventureforge.llm.router.GeminiClient") as mock_gemini_cls, \
         patch("ventureforge.llm.router.RateLimiter"):
        settings = mock_settings.return_value
        settings.deep_reasoning_model = "claude-opus-4-6"
        settings.fast_model = "claude-sonnet-4-6"
        settings.gemini_api_key = ""
        # Gemini not available (no key)
        mock_gemini_cls.return_value.available = False
        return LLMRouter()


@pytest.fixture
def router_with_gemini() -> LLMRouter:
    with patch("ventureforge.llm.router.get_settings") as mock_settings, \
         patch("ventureforge.llm.router.AnthropicClient"), \
         patch("ventureforge.llm.router.OpenAIClient"), \
         patch("ventureforge.llm.router.GeminiClient") as mock_gemini_cls, \
         patch("ventureforge.llm.router.RateLimiter"):
        settings = mock_settings.return_value
        settings.deep_reasoning_model = "gemini-2.5-pro"
        settings.fast_model = "gemini-2.5-flash"
        settings.gemini_api_key = "test-key"
        mock_gemini_cls.return_value.available = True
        return LLMRouter()


class TestResolveModel:
    def test_deep_reasoning_hint_anthropic(self, router: LLMRouter):
        """Without Gemini, falls back to Anthropic routing."""
        assert router.resolve_model("deep_reasoning") == "claude-opus-4-6"

    def test_fast_extraction_hint_anthropic(self, router: LLMRouter):
        assert router.resolve_model("fast_extraction") == "claude-sonnet-4-6"

    def test_deep_reasoning_hint_gemini(self, router_with_gemini: LLMRouter):
        """With Gemini available, routes to Gemini models."""
        assert router_with_gemini.resolve_model("deep_reasoning") == "gemini-2.5-pro"

    def test_fast_extraction_hint_gemini(self, router_with_gemini: LLMRouter):
        assert router_with_gemini.resolve_model("fast_extraction") == "gemini-2.5-flash"

    def test_all_anthropic_hints_resolve(self, router: LLMRouter):
        for hint, expected_model in ANTHROPIC_MODEL_ROUTING.items():
            assert router.resolve_model(hint) == expected_model

    def test_all_gemini_hints_resolve(self, router_with_gemini: LLMRouter):
        for hint, expected_model in GEMINI_MODEL_ROUTING.items():
            assert router_with_gemini.resolve_model(hint) == expected_model

    def test_direct_model_id_passthrough(self, router: LLMRouter):
        assert router.resolve_model("gpt-4o") == "gpt-4o"
        assert router.resolve_model("claude-opus-4-6") == "claude-opus-4-6"

    def test_unknown_hint_treated_as_model_id(self, router: LLMRouter):
        assert router.resolve_model("my-custom-model") == "my-custom-model"


class TestSelectClient:
    def test_gemini_model_selects_gemini(self, router_with_gemini: LLMRouter):
        client = router_with_gemini._select_client("gemini-2.5-pro")
        assert client is router_with_gemini._gemini

    def test_anthropic_fallback(self, router: LLMRouter):
        client = router._select_client("claude-opus-4-6")
        assert client is router._anthropic
