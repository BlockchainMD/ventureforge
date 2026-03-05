"""Application configuration via pydantic-settings."""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """All VentureForge configuration loaded from environment variables."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    # LLM API keys
    anthropic_api_key: str = ""
    openai_api_key: str | None = None

    # Google Gemini
    gemini_api_key: str = ""

    # Research
    tavily_api_key: str = ""
    crunchbase_api_key: str | None = None

    # Database
    database_url: str = "sqlite:///./ventureforge.db"

    # Orchestration
    default_max_rounds: int = 4
    default_quality_threshold: float = 0.82
    max_concurrent_research_threads: int = 5
    research_cache_ttl_hours: int = 24

    # LLM settings
    deep_reasoning_model: str = "claude-opus-4-6"
    fast_model: str = "claude-sonnet-4-6"
    max_tokens_default: int = 4096
    temperature_default: float = 0.7

    # Output
    output_dir: str = "./outputs"

    def is_dry_run(self) -> bool:
        """Check if API keys are missing, indicating dry-run mode."""
        return not self.anthropic_api_key or not self.tavily_api_key


_settings: Settings | None = None


def get_settings() -> Settings:
    """Get or create the singleton settings instance."""
    global _settings  # noqa: PLW0603
    if _settings is None:
        _settings = Settings()
    return _settings
