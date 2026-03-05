"""Retry decorators with exponential backoff."""

from __future__ import annotations

from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential_jitter,
)

from ventureforge.core.exceptions import LLMRateLimitError, ResearchError

llm_retry = retry(
    retry=retry_if_exception_type((LLMRateLimitError, TimeoutError)),
    stop=stop_after_attempt(3),
    wait=wait_exponential_jitter(initial=1, max=30, jitter=2),
    reraise=True,
)

research_retry = retry(
    retry=retry_if_exception_type((ResearchError, TimeoutError, ConnectionError)),
    stop=stop_after_attempt(5),
    wait=wait_exponential_jitter(initial=0.5, max=20, jitter=1),
    reraise=True,
)
