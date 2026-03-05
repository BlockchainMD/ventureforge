"""Tavily API wrapper for web search."""

from __future__ import annotations

import asyncio
from typing import Any, Literal

from ventureforge.core.config import get_settings
from ventureforge.core.exceptions import ResearchError
from ventureforge.research.cache import ResearchCache
from ventureforge.utils.logger import get_logger
from ventureforge.utils.retry import research_retry

logger = get_logger()


class SearchResult:
    """Structured search result from Tavily."""

    def __init__(self, query: str, results: list[dict[str, Any]]) -> None:
        self.query = query
        self.results = results

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {"query": self.query, "results": self.results}


class TavilyClient:
    """Async wrapper around the Tavily search API."""

    def __init__(self, cache: ResearchCache | None = None) -> None:
        self._api_key = get_settings().tavily_api_key
        self._cache = cache or ResearchCache()
        self._client = None

    @property
    def client(self):
        """Lazy-init the Tavily client."""
        if self._client is None:
            from tavily import AsyncTavilyClient

            self._client = AsyncTavilyClient(api_key=self._api_key)
        return self._client

    @research_retry
    async def search(
        self,
        query: str,
        search_depth: Literal["basic", "advanced"] = "advanced",
        max_results: int = 8,
        include_domains: list[str] | None = None,
        exclude_domains: list[str] | None = None,
    ) -> SearchResult:
        """Execute a single search query with caching."""
        # Check cache first
        cached = self._cache.get(query, search_depth)
        if cached is not None:
            return SearchResult(query=query, results=cached)

        try:
            kwargs: dict[str, Any] = {
                "query": query,
                "search_depth": search_depth,
                "max_results": max_results,
            }
            if include_domains:
                kwargs["include_domains"] = include_domains
            if exclude_domains:
                kwargs["exclude_domains"] = exclude_domains

            response = await self.client.search(**kwargs)
            results = response.get("results", [])

            # Normalize results
            normalized = [
                {
                    "title": r.get("title", ""),
                    "url": r.get("url", ""),
                    "content": r.get("content", ""),
                    "score": r.get("score", 0.0),
                    "published_date": r.get("published_date"),
                }
                for r in results
            ]

            self._cache.set(query, normalized, search_depth)
            logger.info("tavily_search", query=query[:80], result_count=len(normalized))
            return SearchResult(query=query, results=normalized)

        except Exception as e:
            raise ResearchError(f"Tavily search failed for '{query}': {e}") from e

    async def search_batch(
        self,
        queries: list[str],
        search_depth: Literal["basic", "advanced"] = "advanced",
        max_results: int = 8,
        max_concurrent: int | None = None,
    ) -> list[SearchResult]:
        """Run multiple searches concurrently with rate limiting."""
        max_conc = max_concurrent or get_settings().max_concurrent_research_threads
        semaphore = asyncio.Semaphore(max_conc)

        async def _bounded_search(q: str) -> SearchResult:
            async with semaphore:
                return await self.search(q, search_depth=search_depth, max_results=max_results)

        results = await asyncio.gather(
            *[_bounded_search(q) for q in queries],
            return_exceptions=True,
        )

        search_results: list[SearchResult] = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                logger.warning("batch_search_failed", query=queries[i], error=str(result))
                search_results.append(SearchResult(query=queries[i], results=[]))
            else:
                search_results.append(result)

        return search_results
