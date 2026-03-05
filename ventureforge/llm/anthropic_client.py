"""Anthropic SDK wrapper with rate limiting and retry."""

from __future__ import annotations

import json
import time
from typing import Any

import anthropic

from ventureforge.core.config import get_settings
from ventureforge.core.exceptions import LLMError, LLMRateLimitError
from ventureforge.core.schemas import TokenUsage
from ventureforge.llm.rate_limiter import RateLimiter
from ventureforge.utils.logger import get_logger
from ventureforge.utils.retry import llm_retry

logger = get_logger()


class AnthropicClient:
    """Async wrapper around the Anthropic API."""

    def __init__(self, rate_limiter: RateLimiter | None = None) -> None:
        settings = get_settings()
        self._client: anthropic.AsyncAnthropic | None = None
        self._api_key = settings.anthropic_api_key
        self._rate_limiter = rate_limiter or RateLimiter()

    @property
    def client(self) -> anthropic.AsyncAnthropic:
        """Lazy-init the async client."""
        if self._client is None:
            self._client = anthropic.AsyncAnthropic(api_key=self._api_key)
        return self._client

    @llm_retry
    async def generate(
        self,
        system_prompt: str,
        user_prompt: str,
        model: str = "claude-sonnet-4-6",
        max_tokens: int = 4096,
        temperature: float = 0.7,
        response_format: dict[str, Any] | None = None,
    ) -> tuple[str, TokenUsage]:
        """Generate a completion from Claude.

        Returns the response text and token usage.
        """
        await self._rate_limiter.acquire(estimated_tokens=max_tokens)
        start = time.monotonic()
        try:
            kwargs: dict[str, Any] = {
                "model": model,
                "max_tokens": max_tokens,
                "temperature": temperature,
                "system": system_prompt,
                "messages": [{"role": "user", "content": user_prompt}],
            }

            response = await self.client.messages.create(**kwargs)

            text = ""
            for block in response.content:
                if block.type == "text":
                    text += block.text

            usage = TokenUsage(
                input_tokens=response.usage.input_tokens,
                output_tokens=response.usage.output_tokens,
                model=model,
            )
            duration = time.monotonic() - start
            logger.info(
                "anthropic_call",
                model=model,
                input_tokens=usage.input_tokens,
                output_tokens=usage.output_tokens,
                duration_seconds=round(duration, 2),
            )
            self._rate_limiter.release(usage.input_tokens + usage.output_tokens)
            return text, usage

        except anthropic.RateLimitError as e:
            self._rate_limiter.release()
            raise LLMRateLimitError(str(e)) from e
        except anthropic.APIError as e:
            self._rate_limiter.release()
            raise LLMError(str(e)) from e

    async def generate_json(
        self,
        system_prompt: str,
        user_prompt: str,
        model: str = "claude-sonnet-4-6",
        max_tokens: int = 4096,
        temperature: float = 0.7,
    ) -> tuple[dict[str, Any], TokenUsage]:
        """Generate a JSON response from Claude.

        Instructs the model to output valid JSON and parses it.
        """
        json_instruction = (
            "\n\nIMPORTANT: Respond ONLY with valid JSON. No markdown, no explanation, "
            "no code fences. Just the JSON object."
        )
        text, usage = await self.generate(
            system_prompt=system_prompt,
            user_prompt=user_prompt + json_instruction,
            model=model,
            max_tokens=max_tokens,
            temperature=temperature,
        )

        # Strip any markdown code fences
        cleaned = text.strip()
        if cleaned.startswith("```"):
            lines = cleaned.split("\n")
            lines = lines[1:]  # Remove opening fence
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]  # Remove closing fence
            cleaned = "\n".join(lines)

        try:
            data = json.loads(cleaned)
        except json.JSONDecodeError as e:
            raise LLMError(f"Failed to parse JSON response: {e}\nRaw: {text[:500]}") from e

        return data, usage
