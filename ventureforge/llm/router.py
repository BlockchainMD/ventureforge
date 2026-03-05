"""LLM routing logic - decides which model/client to use for each task."""

from __future__ import annotations

from typing import Any

from ventureforge.core.config import get_settings
from ventureforge.core.schemas import TokenUsage
from ventureforge.llm.anthropic_client import AnthropicClient
from ventureforge.llm.openai_client import OpenAIClient
from ventureforge.llm.rate_limiter import RateLimiter, RateLimiterConfig

# Model routing policy
MODEL_ROUTING: dict[str, str] = {
    "deep_reasoning": "claude-opus-4-6",
    "fast_extraction": "claude-sonnet-4-6",
    "quantitative": "claude-opus-4-6",
    "context_heavy": "claude-opus-4-6",
}


class LLMRouter:
    """Routes LLM calls to the appropriate model and client."""

    def __init__(self) -> None:
        settings = get_settings()
        rate_limiter = RateLimiter(RateLimiterConfig())
        self._anthropic = AnthropicClient(rate_limiter=rate_limiter)
        self._openai = OpenAIClient(rate_limiter=RateLimiter(RateLimiterConfig()))
        self._deep_model = settings.deep_reasoning_model
        self._fast_model = settings.fast_model

    def resolve_model(self, model_hint: str) -> str:
        """Resolve a model hint to an actual model ID."""
        if model_hint in MODEL_ROUTING:
            return MODEL_ROUTING[model_hint]
        # Allow direct model IDs
        return model_hint

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
        return await self._anthropic.generate(
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
        return await self._anthropic.generate_json(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            model=model,
            max_tokens=max_tokens,
            temperature=temperature,
        )
