"""Research orchestration engine."""

from __future__ import annotations

import asyncio
from typing import Any

from ventureforge.core.config import get_settings
from ventureforge.core.schemas import ResearchBundle
from ventureforge.llm.router import LLMRouter
from ventureforge.research.cache import ResearchCache
from ventureforge.research.crunchbase_client import CrunchbaseClient
from ventureforge.research.synthesizer import ResearchSynthesizer
from ventureforge.research.tavily_client import TavilyClient
from ventureforge.utils.logger import get_logger

logger = get_logger()


class ResearchEngine:
    """Orchestrates research across multiple sources."""

    def __init__(self, llm_router: LLMRouter, cache: ResearchCache | None = None) -> None:
        self._cache = cache or ResearchCache()
        self._tavily = TavilyClient(cache=self._cache)
        self._crunchbase = CrunchbaseClient()
        self._synthesizer = ResearchSynthesizer(llm_router)

    async def research_topic(self, queries: list[str]) -> ResearchBundle:
        """Run multiple queries and synthesize results into a single bundle."""
        search_results = await self._tavily.search_batch(queries)
        all_results: list[dict[str, Any]] = []
        for sr in search_results:
            all_results.extend(sr.results)

        # Synthesize all results together
        combined_query = " | ".join(queries[:3])
        bundle = await self._synthesizer.synthesize(combined_query, all_results)
        return bundle

    async def research_opportunity(
        self, title: str, problem_space: str
    ) -> ResearchBundle:
        """Run standard research queries for a business opportunity."""
        queries = [
            f"{problem_space} software market size 2024 2025",
            f"{problem_space} startup funding recent",
            f"best {problem_space} tools complaints reviews",
            f"{problem_space} AI automation workflow",
            f"agentic AI {problem_space} use case",
        ]
        return await self.research_topic(queries)

    async def research_opportunities_batch(
        self, opportunities: list[dict[str, str]]
    ) -> dict[str, ResearchBundle]:
        """Research multiple opportunities in parallel."""
        settings = get_settings()
        semaphore = asyncio.Semaphore(settings.max_concurrent_research_threads)

        async def _bounded_research(opp: dict[str, str]) -> tuple[str, ResearchBundle]:
            async with semaphore:
                title = opp["title"]
                bundle = await self.research_opportunity(title, opp["problem_space"])
                return title, bundle

        results = await asyncio.gather(
            *[_bounded_research(opp) for opp in opportunities],
            return_exceptions=True,
        )

        bundles: dict[str, ResearchBundle] = {}
        for i, result in enumerate(results):
            title = opportunities[i]["title"]
            if isinstance(result, Exception):
                logger.warning("opportunity_research_failed", title=title, error=str(result))
                bundles[title] = ResearchBundle(query=title, insights=[], raw_results=[])
            else:
                bundles[result[0]] = result[1]

        return bundles

    @property
    def cache_stats(self) -> dict[str, Any]:
        """Return cache statistics."""
        return self._cache.stats()
