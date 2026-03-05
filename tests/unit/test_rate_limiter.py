"""Tests for rate limiter."""

from __future__ import annotations

import asyncio

from ventureforge.llm.rate_limiter import RateLimiter, RateLimiterConfig


async def test_acquire_and_release():
    rl = RateLimiter(RateLimiterConfig(requests_per_minute=100))
    await rl.acquire(estimated_tokens=100)
    rl.release(tokens_used=50)
    assert rl._current_rpm() == 1
    assert rl._current_tpm() == 50


async def test_semaphore_limits_concurrency():
    rl = RateLimiter(RateLimiterConfig(max_concurrent=2))
    await rl.acquire()
    await rl.acquire()
    # Third acquire would block; just verify we got here
    rl.release()
    rl.release()


def test_clean_old_entries():
    rl = RateLimiter(RateLimiterConfig())
    rl._request_timestamps = [0.0, 0.0]  # Very old timestamps
    rl._clean_old_entries()
    assert len(rl._request_timestamps) == 0
