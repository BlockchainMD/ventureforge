"""Converts raw research into structured insight objects."""

from __future__ import annotations

from typing import Any

from ventureforge.core.schemas import ResearchBundle, ResearchInsight
from ventureforge.llm.router import LLMRouter
from ventureforge.utils.logger import get_logger

logger = get_logger()


class ResearchSynthesizer:
    """Synthesizes raw search results into structured ResearchInsight objects."""

    def __init__(self, llm_router: LLMRouter) -> None:
        self._llm = llm_router

    async def synthesize(
        self, query: str, raw_results: list[dict[str, Any]]
    ) -> ResearchBundle:
        """Convert raw search results into a structured research bundle."""
        if not raw_results:
            return ResearchBundle(query=query, insights=[], raw_results=[])

        # Format raw results for the LLM
        formatted = "\n\n".join(
            f"Source: {r.get('url', 'unknown')}\n"
            f"Title: {r.get('title', 'untitled')}\n"
            f"Content: {r.get('content', '')[:1500]}"
            for r in raw_results[:10]
        )

        system_prompt = (
            "You are a research analyst. Extract structured insights from raw web search "
            "results. For each distinct factual claim, provide: the claim, confidence level "
            "(high/medium/low), source URL, category (market_size/competitor/customer_pain/"
            "timing/funding), and any contradictions with other findings.\n"
            "Return JSON: {\"insights\": [{\"claim\": ..., \"confidence\": ..., "
            "\"source_url\": ..., \"category\": ..., \"contradicts\": []}]}"
        )

        user_prompt = f"Query: {query}\n\nRaw results:\n{formatted}"

        try:
            data, usage = await self._llm.generate_json(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                model_hint="fast_extraction",
                max_tokens=3000,
                temperature=0.3,
            )

            insights = []
            for item in data.get("insights", []):
                try:
                    insights.append(
                        ResearchInsight(
                            claim=item.get("claim", ""),
                            confidence=item.get("confidence", "low"),
                            source_url=item.get("source_url", ""),
                            category=item.get("category", ""),
                            contradicts=item.get("contradicts", []),
                        )
                    )
                except Exception:
                    continue

            logger.info("research_synthesized", query=query[:60], insight_count=len(insights))
            return ResearchBundle(query=query, insights=insights, raw_results=raw_results)

        except Exception as e:
            logger.warning("synthesis_failed", query=query, error=str(e))
            return ResearchBundle(query=query, insights=[], raw_results=raw_results)
