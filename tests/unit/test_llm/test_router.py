"""Tests for LLMRouter.resolve_model."""

from __future__ import annotations

from unittest.mock import patch

import pytest

from ventureforge.llm.router import MODEL_ROUTING, LLMRouter


@pytest.fixture
def router() -> LLMRouter:
    with patch("ventureforge.llm.router.get_settings") as mock_settings, \
         patch("ventureforge.llm.router.AnthropicClient"), \
         patch("ventureforge.llm.router.OpenAIClient"), \
         patch("ventureforge.llm.router.RateLimiter"):
        settings = mock_settings.return_value
        settings.deep_reasoning_model = "claude-opus-4-6"
        settings.fast_model = "claude-sonnet-4-6"
        return LLMRouter()


class TestResolveModel:
    def test_deep_reasoning_hint(self, router: LLMRouter):
        assert router.resolve_model("deep_reasoning") == "claude-opus-4-6"

    def test_fast_extraction_hint(self, router: LLMRouter):
        assert router.resolve_model("fast_extraction") == "claude-sonnet-4-6"

    def test_quantitative_hint(self, router: LLMRouter):
        assert router.resolve_model("quantitative") == "claude-opus-4-6"

    def test_context_heavy_hint(self, router: LLMRouter):
        assert router.resolve_model("context_heavy") == "claude-opus-4-6"

    def test_all_known_hints_resolve(self, router: LLMRouter):
        for hint, expected_model in MODEL_ROUTING.items():
            assert router.resolve_model(hint) == expected_model

    def test_direct_model_id_passthrough(self, router: LLMRouter):
        assert router.resolve_model("gpt-4o") == "gpt-4o"
        assert router.resolve_model("claude-opus-4-6") == "claude-opus-4-6"

    def test_unknown_hint_treated_as_model_id(self, router: LLMRouter):
        assert router.resolve_model("my-custom-model") == "my-custom-model"
