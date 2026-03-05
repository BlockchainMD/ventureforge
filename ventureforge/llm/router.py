"""LLM routing logic - decides which model/client to use for each task."""

from __future__ import annotations

from typing import Any

from ventureforge.core.config import get_settings
from ventureforge.core.schemas import TokenUsage
from ventureforge.llm.anthropic_client import AnthropicClient
from ventureforge.llm.gemini_client import GeminiClient
from ventureforge.llm.openai_client import OpenAIClient
from ventureforge.llm.rate_limiter import RateLimiter, RateLimiterConfig
from ventureforge.utils.logger import get_logger

logger = get_logger()

# Model routing policy - maps hints to Gemini models
GEMINI_MODEL_ROUTING: dict[str, str] = {
    "deep_reasoning": "gemini-2.5-pro",
    "fast_extraction": "gemini-2.5-flash",
    "quantitative": "gemini-2.5-pro",
    "context_heavy": "gemini-2.5-pro",
}

ANTHROPIC_MODEL_ROUTING: dict[str, str] = {
    "deep_reasoning": "claude-opus-4-6",
    "fast_extraction": "claude-sonnet-4-6",
    "quantitative": "claude-opus-4-6",
    "context_heavy": "claude-opus-4-6",
}


class LLMRouter:
    """Routes LLM calls to the appropriate model and client.

    Priority: Gemini (if key set) → Anthropic → OpenAI
    """

    def __init__(self) -> None:
        settings = get_settings()
        rate_limiter = RateLimiter(RateLimiterConfig())
        self._gemini = GeminiClient(rate_limiter=RateLimiter(RateLimiterConfig()))
        self._anthropic = AnthropicClient(rate_limiter=rate_limiter)
        self._openai = OpenAIClient(rate_limiter=RateLimiter(RateLimiterConfig()))
        self._deep_model = settings.deep_reasoning_model
        self._fast_model = settings.fast_model

    def resolve_model(self, model_hint: str) -> str:
        """Resolve a model hint to an actual model ID."""
        if self._gemini.available and model_hint in GEMINI_MODEL_ROUTING:
            return GEMINI_MODEL_ROUTING[model_hint]
        if model_hint in ANTHROPIC_MODEL_ROUTING:
            return ANTHROPIC_MODEL_ROUTING[model_hint]
        return model_hint

    def _select_client(self, model: str) -> GeminiClient | AnthropicClient | OpenAIClient:
        """Pick the right client based on the resolved model name."""
        if model.startswith("gemini") and self._gemini.available:
            return self._gemini
        if model.startswith("gpt") and self._openai.available:
            return self._openai
        return self._anthropic

    async def generate(
        self,
        system_prompt: str,
        user_prompt: str,
        model_hint: str = "deep_reasoning",
        max_tokens: int = 4096,
        temperature: float = 0.7,
    ) -> tuple[str, TokenUsage]:
        """Generate text using the appropriate model."""
        model = self.resolve_model(model_hint)
        client = self._select_client(model)
        return await client.generate(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            model=model,
            max_tokens=max_tokens,
            temperature=temperature,
        )

    async def generate_json(
        self,
        system_prompt: str,
        user_prompt: str,
        model_hint: str = "deep_reasoning",
        max_tokens: int = 4096,
        temperature: float = 0.7,
    ) -> tuple[dict[str, Any], TokenUsage]:
        """Generate structured JSON using the appropriate model."""
        model = self.resolve_model(model_hint)
        client = self._select_client(model)
        return await client.generate_json(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            model=model,
            max_tokens=max_tokens,
            temperature=temperature,
        )
