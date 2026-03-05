"""OpenAI SDK wrapper for specific tasks (fallback/specialized)."""

from __future__ import annotations

import json
import time
from typing import Any

from ventureforge.core.config import get_settings
from ventureforge.core.exceptions import LLMError, LLMRateLimitError
from ventureforge.core.schemas import TokenUsage
from ventureforge.llm.rate_limiter import RateLimiter
from ventureforge.utils.logger import get_logger
from ventureforge.utils.retry import llm_retry

logger = get_logger()


class OpenAIClient:
    """Async wrapper around the OpenAI API."""

    def __init__(self, rate_limiter: RateLimiter | None = None) -> None:
        settings = get_settings()
        self._client = None
        self._api_key = settings.openai_api_key
        self._rate_limiter = rate_limiter or RateLimiter()

    @property
    def client(self):
        """Lazy-init the async client."""
        if self._client is None:
            import openai

            self._client = openai.AsyncOpenAI(api_key=self._api_key or "")
        return self._client

    @property
    def available(self) -> bool:
        """Check if OpenAI API key is configured."""
        return bool(self._api_key)

    @llm_retry
    async def generate(
        self,
        system_prompt: str,
        user_prompt: str,
        model: str = "gpt-4o",
        max_tokens: int = 4096,
        temperature: float = 0.7,
    ) -> tuple[str, TokenUsage]:
        """Generate a completion from OpenAI."""
        import openai

        await self._rate_limiter.acquire(estimated_tokens=max_tokens)
        start = time.monotonic()
        try:
            response = await self.client.chat.completions.create(
                model=model,
                max_tokens=max_tokens,
                temperature=temperature,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
            )
            text = response.choices[0].message.content or ""
            usage = TokenUsage(
                input_tokens=response.usage.prompt_tokens if response.usage else 0,
                output_tokens=response.usage.completion_tokens if response.usage else 0,
                model=model,
            )
            duration = time.monotonic() - start
            logger.info("openai_call", model=model, duration_seconds=round(duration, 2))
            self._rate_limiter.release(usage.input_tokens + usage.output_tokens)
            return text, usage

        except openai.RateLimitError as e:
            self._rate_limiter.release()
            raise LLMRateLimitError(str(e)) from e
        except openai.APIError as e:
            self._rate_limiter.release()
            raise LLMError(str(e)) from e

    async def generate_json(
        self,
        system_prompt: str,
        user_prompt: str,
        model: str = "gpt-4o",
        max_tokens: int = 4096,
        temperature: float = 0.7,
    ) -> tuple[dict[str, Any], TokenUsage]:
        """Generate a JSON response from OpenAI."""
        text, usage = await self.generate(
            system_prompt=system_prompt,
            user_prompt=user_prompt + "\n\nRespond ONLY with valid JSON.",
            model=model,
            max_tokens=max_tokens,
            temperature=temperature,
        )
        cleaned = text.strip()
        if cleaned.startswith("```"):
            lines = cleaned.split("\n")
            lines = lines[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            cleaned = "\n".join(lines)
        try:
            data = json.loads(cleaned)
        except json.JSONDecodeError as e:
            raise LLMError(f"Failed to parse JSON: {e}") from e
        return data, usage
