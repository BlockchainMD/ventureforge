"""Token and request rate limiting with backoff."""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field

from ventureforge.utils.logger import get_logger

logger = get_logger()


@dataclass
class RateLimiterConfig:
    """Configuration for rate limiting."""

    requests_per_minute: int = 50
    tokens_per_minute: int = 100_000
    max_concurrent: int = 5


@dataclass
class RateLimiter:
    """Token-aware rate limiter for LLM API calls."""

    config: RateLimiterConfig = field(default_factory=RateLimiterConfig)
    _request_timestamps: list[float] = field(default_factory=list)
    _token_timestamps: list[tuple[float, int]] = field(default_factory=list)
    _semaphore: asyncio.Semaphore | None = None

    @property
    def semaphore(self) -> asyncio.Semaphore:
        """Lazy-init semaphore."""
        if self._semaphore is None:
            self._semaphore = asyncio.Semaphore(self.config.max_concurrent)
        return self._semaphore

    def _clean_old_entries(self) -> None:
        """Remove entries older than 60 seconds."""
        cutoff = time.monotonic() - 60.0
        self._request_timestamps = [t for t in self._request_timestamps if t > cutoff]
        self._token_timestamps = [(t, n) for t, n in self._token_timestamps if t > cutoff]

    def _current_rpm(self) -> int:
        """Requests in the last minute."""
        self._clean_old_entries()
        return len(self._request_timestamps)

    def _current_tpm(self) -> int:
        """Tokens in the last minute."""
        self._clean_old_entries()
        return sum(n for _, n in self._token_timestamps)

    async def acquire(self, estimated_tokens: int = 1000) -> None:
        """Wait until rate limits allow the request."""
        while True:
            self._clean_old_entries()
            rpm_ok = self._current_rpm() < self.config.requests_per_minute
            tpm_ok = self._current_tpm() + estimated_tokens <= self.config.tokens_per_minute

            if rpm_ok and tpm_ok:
                break

            wait_time = 1.0
            if not rpm_ok and self._request_timestamps:
                oldest = self._request_timestamps[0]
                wait_time = max(wait_time, 60.0 - (time.monotonic() - oldest) + 0.1)
            logger.debug("rate_limit_wait", wait_seconds=round(wait_time, 1))
            await asyncio.sleep(min(wait_time, 5.0))

        await self.semaphore.acquire()

    def release(self, tokens_used: int = 0) -> None:
        """Record usage and release semaphore."""
        now = time.monotonic()
        self._request_timestamps.append(now)
        if tokens_used > 0:
            self._token_timestamps.append((now, tokens_used))
        self.semaphore.release()
