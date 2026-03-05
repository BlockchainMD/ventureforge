"""Research result caching with TTL."""

from __future__ import annotations

import hashlib
import time
from typing import Any

from ventureforge.core.config import get_settings
from ventureforge.utils.logger import get_logger

logger = get_logger()


class ResearchCache:
    """In-memory cache for research results with configurable TTL."""

    def __init__(self, ttl_hours: int | None = None) -> None:
        self._ttl_seconds = (ttl_hours or get_settings().research_cache_ttl_hours) * 3600
        self._cache: dict[str, tuple[float, Any]] = {}

    @staticmethod
    def _make_key(query: str, search_depth: str = "advanced") -> str:
        """Generate a cache key from query and search depth."""
        raw = f"{query}|{search_depth}"
        return hashlib.sha256(raw.encode()).hexdigest()

    def get(self, query: str, search_depth: str = "advanced") -> Any | None:
        """Get cached result if it exists and hasn't expired."""
        key = self._make_key(query, search_depth)
        entry = self._cache.get(key)
        if entry is None:
            return None
        timestamp, data = entry
        if time.time() - timestamp > self._ttl_seconds:
            del self._cache[key]
            return None
        logger.debug("cache_hit", query=query[:50])
        return data

    def set(self, query: str, data: Any, search_depth: str = "advanced") -> None:
        """Store a result in the cache."""
        key = self._make_key(query, search_depth)
        self._cache[key] = (time.time(), data)

    def clear(self) -> None:
        """Clear all cached entries."""
        self._cache.clear()

    @property
    def size(self) -> int:
        """Number of entries in cache."""
        return len(self._cache)

    def stats(self) -> dict[str, Any]:
        """Return cache statistics."""
        now = time.time()
        expired = sum(1 for ts, _ in self._cache.values() if now - ts > self._ttl_seconds)
        return {
            "total_entries": len(self._cache),
            "expired_entries": expired,
            "active_entries": len(self._cache) - expired,
        }
