"""Tests for application configuration."""

from __future__ import annotations

import pytest

from ventureforge.core.config import Settings


class TestSettingsDefaults:
    def test_default_database_url(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.delenv("DATABASE_URL", raising=False)
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        monkeypatch.delenv("TAVILY_API_KEY", raising=False)
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)
        s = Settings(anthropic_api_key="", tavily_api_key="", gemini_api_key="")
        assert "sqlite" in s.database_url

    def test_default_llm_settings(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        s = Settings(anthropic_api_key="")
        assert s.deep_reasoning_model == "claude-opus-4-6"
        assert s.fast_model == "claude-sonnet-4-6"
        assert s.max_tokens_default == 4096
        assert s.temperature_default == 0.7

    def test_default_orchestration(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        s = Settings(anthropic_api_key="")
        assert s.default_max_rounds == 4
        assert s.default_quality_threshold == 0.82
        assert s.max_concurrent_research_threads == 5

    def test_api_keys_default_empty(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        monkeypatch.delenv("TAVILY_API_KEY", raising=False)
        monkeypatch.delenv("CRUNCHBASE_API_KEY", raising=False)
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)
        s = Settings(anthropic_api_key="", tavily_api_key="", gemini_api_key="")
        assert s.anthropic_api_key == ""
        assert s.openai_api_key is None
        assert s.tavily_api_key == ""
        assert s.crunchbase_api_key is None
        assert s.gemini_api_key == ""


class TestIsDryRun:
    def test_dry_run_when_no_keys(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        monkeypatch.delenv("TAVILY_API_KEY", raising=False)
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)
        s = Settings(anthropic_api_key="", tavily_api_key="", gemini_api_key="")
        assert s.is_dry_run() is True

    def test_not_dry_run_with_gemini_key(self, monkeypatch: pytest.MonkeyPatch):
        s = Settings(gemini_api_key="AIza-test", anthropic_api_key="", tavily_api_key="")
        assert s.is_dry_run() is False

    def test_not_dry_run_with_anthropic_key(self, monkeypatch: pytest.MonkeyPatch):
        s = Settings(anthropic_api_key="sk-ant-123", gemini_api_key="", tavily_api_key="")
        assert s.is_dry_run() is False

    def test_not_dry_run_with_both_keys(self, monkeypatch: pytest.MonkeyPatch):
        s = Settings(gemini_api_key="AIza-test", anthropic_api_key="sk-ant-123", tavily_api_key="")
        assert s.is_dry_run() is False
