"""Google Gemini API wrapper with rate limiting and retry."""

from __future__ import annotations

import json
import time
from typing import Any

import httpx

from ventureforge.core.config import get_settings
from ventureforge.core.exceptions import LLMError, LLMRateLimitError
from ventureforge.core.schemas import TokenUsage
from ventureforge.llm.rate_limiter import RateLimiter
from ventureforge.utils.logger import get_logger
from ventureforge.utils.retry import llm_retry

logger = get_logger()

GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"


class GeminiClient:
    """Async wrapper around the Google Gemini API (REST)."""

    def __init__(self, rate_limiter: RateLimiter | None = None) -> None:
        settings = get_settings()
        self._api_key = settings.gemini_api_key
        self._rate_limiter = rate_limiter or RateLimiter()

    @property
    def available(self) -> bool:
        """Whether a Gemini API key is configured."""
        return bool(self._api_key)

    @llm_retry
    async def generate(
        self,
        system_prompt: str,
        user_prompt: str,
        model: str = "gemini-2.5-flash",
        max_tokens: int = 4096,
        temperature: float = 0.7,
    ) -> tuple[str, TokenUsage]:
        """Generate a completion from Gemini."""
        await self._rate_limiter.acquire(estimated_tokens=max_tokens)
        start = time.monotonic()

        url = f"{GEMINI_API_BASE}/{model}:generateContent?key={self._api_key}"
        payload: dict[str, Any] = {
            "system_instruction": {"parts": [{"text": system_prompt}]},
            "contents": [{"parts": [{"text": user_prompt}]}],
            "generationConfig": {
                "maxOutputTokens": max_tokens,
                "temperature": temperature,
            },
        }

        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                response = await client.post(url, json=payload)

                if response.status_code == 429:
                    self._rate_limiter.release()
                    raise LLMRateLimitError(f"Gemini rate limited: {response.text}")

                if response.status_code != 200:
                    self._rate_limiter.release()
                    raise LLMError(f"Gemini API error {response.status_code}: {response.text[:500]}")

                data = response.json()

            # Extract text from response
            candidates = data.get("candidates", [])
            if not candidates:
                self._rate_limiter.release()
                raise LLMError(f"Gemini returned no candidates: {data}")

            text = ""
            for part in candidates[0].get("content", {}).get("parts", []):
                text += part.get("text", "")

            # Extract usage
            usage_data = data.get("usageMetadata", {})
            usage = TokenUsage(
                input_tokens=usage_data.get("promptTokenCount", 0),
                output_tokens=usage_data.get("candidatesTokenCount", 0),
                model=model,
            )

            duration = time.monotonic() - start
            logger.info(
                "gemini_call",
                model=model,
                input_tokens=usage.input_tokens,
                output_tokens=usage.output_tokens,
                duration_seconds=round(duration, 2),
            )
            self._rate_limiter.release(usage.input_tokens + usage.output_tokens)
            return text, usage

        except (LLMError, LLMRateLimitError):
            raise
        except Exception as e:
            self._rate_limiter.release()
            raise LLMError(f"Gemini request failed: {e}") from e

    async def generate_json(
        self,
        system_prompt: str,
        user_prompt: str,
        model: str = "gemini-2.5-flash",
        max_tokens: int = 4096,
        temperature: float = 0.7,
    ) -> tuple[dict[str, Any], TokenUsage]:
        """Generate a JSON response from Gemini."""
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
            lines = lines[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            cleaned = "\n".join(lines)

        try:
            data = json.loads(cleaned)
        except json.JSONDecodeError as e:
            raise LLMError(f"Failed to parse JSON response: {e}\nRaw: {text[:500]}") from e

        return data, usage
