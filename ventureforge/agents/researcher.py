"""ResearcherAgent - gathers web data without LLM generation."""

from __future__ import annotations

import time

from ventureforge.agents.base import AgentConfig, BaseAgent
from ventureforge.core.schemas import (
    AgentOutput,
    ResearchBundle,
    ResearchInsight,
    RoundContext,
    TokenUsage,
)
from ventureforge.llm.router import LLMRouter
from ventureforge.research.engine import ResearchEngine
from ventureforge.utils.logger import get_logger

logger = get_logger()


class ResearcherAgent(BaseAgent):
    """Gathers web and market data for the current context.

    Unlike other agents the ResearcherAgent does **not** call LLMs for
    content generation.  It delegates to :class:`ResearchEngine` which
    queries external sources (Tavily, Crunchbase, etc.) and returns a
    :class:`ResearchBundle`.

    The bundle is wrapped in an :class:`AgentOutput` so the
    orchestrator can treat it uniformly.
    """

    def __init__(self, llm_router: LLMRouter, config: AgentConfig) -> None:
        super().__init__(llm_router, config)
        self._research_engine = ResearchEngine(llm_router)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def run(self, context: RoundContext) -> AgentOutput:
        """Execute research queries and return a ResearchBundle."""
        if self.dry_run:
            return self._get_dry_run_output(context)

        start = time.perf_counter()

        try:
            queries = self._build_queries(context)
            logger.info(
                "researcher_start",
                agent=self.name,
                run_id=context.run_id,
                query_count=len(queries),
            )

            bundle = await self._research_engine.research_topic(queries)
        except Exception:
            logger.exception(
                "researcher_failed",
                agent=self.name,
                run_id=context.run_id,
            )
            raise

        duration = time.perf_counter() - start
        logger.info(
            "researcher_complete",
            agent=self.name,
            run_id=context.run_id,
            insight_count=len(bundle.insights),
            duration=round(duration, 2),
        )

        return self._make_output(
            content=bundle.model_dump(),
            duration=duration,
        )

    # ------------------------------------------------------------------
    # Query construction
    # ------------------------------------------------------------------

    def _build_queries(self, context: RoundContext) -> list[str]:
        """Derive search queries from the current context."""
        queries: list[str] = []

        if context.run_type == "screener":
            queries.extend(self._screener_queries(context))
        else:
            queries.extend(self._builder_queries(context))

        # De-duplicate while preserving order
        seen: set[str] = set()
        unique: list[str] = []
        for q in queries:
            normalised = q.strip().lower()
            if normalised not in seen:
                seen.add(normalised)
                unique.append(q.strip())
        return unique

    def _screener_queries(self, context: RoundContext) -> list[str]:
        """Build queries for the screener pipeline."""
        domain = context.input_config.get("domain", "technology")
        candidates = context.current_content.get("candidates", [])

        queries = [
            f"{domain} AI startup opportunities 2025 2026",
            f"agentic AI market trends {domain}",
            f"{domain} venture capital funding recent rounds",
        ]

        # Add per-candidate queries if candidates already exist
        for candidate in candidates[:5]:
            title = candidate.get("title", "")
            problem = candidate.get("problem_space", "")
            if title:
                queries.append(f"{title} startup market size competitors")
            if problem:
                queries.append(f"{problem} AI automation pain points")

        return queries

    def _builder_queries(self, context: RoundContext) -> list[str]:
        """Build queries for the builder pipeline."""
        opportunity = context.input_config.get("opportunity", {})
        title = opportunity.get("title", "")
        problem = opportunity.get("problem_statement", "")
        section = context.phase_name

        queries = [
            f"{title} market size TAM SAM SOM",
            f"{title} competitors landscape",
            f"{problem} customer pain points reviews",
        ]

        # Section-specific queries
        section_queries: dict[str, list[str]] = {
            "market_analysis": [
                f"{title} addressable market growth rate",
                f"{title} industry analyst reports",
            ],
            "competitive_landscape": [
                f"{title} competitors funding",
                f"{title} alternative solutions comparison",
            ],
            "go_to_market": [
                f"{title} go to market strategy B2B SaaS",
                f"{title} customer acquisition channels",
            ],
            "financial_model": [
                f"{title} SaaS unit economics benchmark",
                f"{title} pricing models comparable companies",
            ],
            "technical_architecture": [
                f"{title} technology stack AI infrastructure",
                f"{title} scalability cloud architecture",
            ],
        }
        queries.extend(section_queries.get(section, []))
        return queries

    # ------------------------------------------------------------------
    # Dry run
    # ------------------------------------------------------------------

    def _get_dry_run_output(self, context: RoundContext) -> AgentOutput:
        """Return mock research insights."""
        mock_insights = [
            ResearchInsight(
                claim="The global compliance-tech market is projected to reach $35B by 2027, growing at 18% CAGR.",
                confidence="high",
                source_url="https://example.com/compliance-market-report",
                category="market_size",
            ),
            ResearchInsight(
                claim="Recent funding rounds include $40M Series B for AutoRegulate (competitor) in Q4 2025.",
                confidence="medium",
                source_url="https://example.com/autoregulate-funding",
                category="competitor",
            ),
            ResearchInsight(
                claim="73% of fintech compliance officers report spending >40% of time on manual regulatory checks.",
                confidence="high",
                source_url="https://example.com/compliance-survey",
                category="customer_pain",
            ),
            ResearchInsight(
                claim="EU AI Act enforcement timelines accelerate demand for automated compliance tooling.",
                confidence="medium",
                source_url="https://example.com/eu-ai-act-timeline",
                category="timing",
            ),
        ]

        bundle = ResearchBundle(
            query="[dry-run] mock research queries",
            insights=mock_insights,
            raw_results=[],
        )

        return self._make_output(
            content=bundle.model_dump(),
            usage=TokenUsage(input_tokens=0, output_tokens=0, model="dry-run"),
            duration=0.0,
            raw_text="[dry-run] Returned 4 mock research insights.",
        )
